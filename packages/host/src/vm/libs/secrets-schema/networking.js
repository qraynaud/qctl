import { z } from 'zod'

import { normalizeMac } from '../proxmox/net.js'
import { BRIDGE_RE, IFACE_RE, namedMapToList } from './zod-utils.js'

/** @import { YamlValue } from '@qctl/shared' */

const portNum = z.coerce.number().int().min(1).max(65535)
const vlanId = z.coerce.number().int().min(1).max(4094)
const ifaceName = z.string().trim().min(1).regex(IFACE_RE, 'must be a Linux interface name')

/**
 * Expand trunks list entries (numbers or "10-20" strings) → sorted unique ints.
 * @param {(string | number)[] | string | number | null | undefined} raw
 * @returns {number[] | null}
 */
export function expandTrunkList(raw) {
  if (raw == null) return null
  const list = Array.isArray(raw) ? raw : [raw]
  const ids = new Set()
  for (const item of list) {
    const s = String(item).trim()
    if (!s) continue
    const range = /^(\d+)-(\d+)$/.exec(s)
    if (range) {
      const a = Number(range[1])
      const b = Number(range[2])
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b > 4094 || a > b) {
        throw new Error(`bad trunk range ${JSON.stringify(s)} (want from-to, 1–4094)`)
      }
      for (let i = a; i <= b; i++) ids.add(i)
      continue
    }
    if (!/^\d+$/.test(s)) {
      throw new Error(`trunk entry must be VLAN id or from-to (got ${JSON.stringify(s)})`)
    }
    const id = Number(s)
    if (!Number.isInteger(id) || id < 1 || id > 4094) {
      throw new Error(`VLAN must be 1–4094 (got ${s})`)
    }
    ids.add(id)
  }
  return ids.size ? [...ids].sort((a, b) => a - b) : null
}

/** Default hypervisor NIC when proxmox.net is omitted (keyed like uplinks). */
export const DEFAULT_PROXMOX_NET = Object.freeze({
  bridge: 'vmbr0',
  vlan: null,
  trunks: null,
  mac: null,
})

const optionalPort = z
  .union([portNum, z.literal(''), z.null(), z.undefined()])
  .transform((v) => (v === '' || v == null ? null : v))

export const portEntrySchema = z.object({
  name: z.string().trim().min(1),
  port: portNum,
  forward: optionalPort.optional().default(null),
  dnat: optionalPort.optional().default(null),
})

export const portsSchema = z.preprocess(
  (raw, ctx) => {
    const list = namedMapToList(/** @type {YamlValue} */ (raw), ctx, [])
    return list === z.NEVER ? z.NEVER : list
  },
  z.array(portEntrySchema).min(1, 'ports must be a non-empty map'),
)

export const uplinkSchema = z.object({
  name: ifaceName,
  dhcp4: z.boolean().optional().default(true),
})

export const uplinksSchema = z.preprocess((raw, ctx) => {
  if (raw == null) return [{ name: 'eth0', dhcp4: true }]
  const list = namedMapToList(/** @type {YamlValue} */ (raw), ctx, [])
  return list === z.NEVER ? z.NEVER : list
}, z.array(uplinkSchema).min(1))

/** Optional host address on this VLAN (Scale macvlan2 / host↔macvlan peers). */
const ipv4Addr = z
  .string()
  .trim()
  .regex(
    /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
    'must be an IPv4 address',
  )

const vlanEntrySchema = z.object({
  name: ifaceName,
  id: vlanId,
  link: ifaceName.optional(),
  ipv4: ipv4Addr.optional(),
})

export const proxmoxNetEntrySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    bridge: z.string().trim().regex(BRIDGE_RE, 'must be a Linux bridge name'),
    tag: z.union([vlanId, z.literal(''), z.null()]).optional(),
    vlan: z.union([vlanId, z.literal(''), z.null()]).optional(),
    trunks: z
      .union([z.array(z.union([z.number(), z.string()])), z.number(), z.string(), z.null()])
      .optional(),
    mac: z.union([z.string(), z.null()]).optional(),
  })
  .transform((raw, ctx) => {
    const tagRaw = raw.tag ?? raw.vlan ?? null
    let vlan = null
    if (tagRaw != null && tagRaw !== '') vlan = Number(tagRaw)

    let trunks = null
    try {
      trunks = expandTrunkList(raw.trunks ?? null)
    } catch (err) {
      ctx.addIssue({
        code: 'custom',
        message: err instanceof Error ? err.message : String(err),
        path: ['trunks'],
      })
      return z.NEVER
    }
    if (vlan != null && trunks?.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'set tag/vlan OR trunks, not both',
        path: ['trunks'],
      })
      return z.NEVER
    }

    let mac = null
    if (raw.mac != null && String(raw.mac).trim() !== '') {
      mac = normalizeMac(raw.mac)
      if (!mac) {
        ctx.addIssue({
          code: 'custom',
          message: `mac invalid (want aa:bb:cc:dd:ee:ff; got ${JSON.stringify(raw.mac)})`,
          path: ['mac'],
        })
        return z.NEVER
      }
    }
    return {
      name: raw.name != null ? String(raw.name).trim() : null,
      bridge: raw.bridge,
      vlan,
      trunks,
      mac,
    }
  })

/**
 * proxmox.net: map keyed by uplink name → ordered list (uplink order applied later).
 * Bare omit → null (caller fills defaults from uplinks).
 */
export const proxmoxNetMapSchema = z.preprocess((raw, ctx) => {
  if (raw == null) return null
  const list = namedMapToList(/** @type {YamlValue} */ (raw), ctx, [])
  return list === z.NEVER ? z.NEVER : list
}, z.array(proxmoxNetEntrySchema).min(1).nullable())

export const networkingSchema = z
  .object({
    ports: portsSchema,
    uplinks: uplinksSchema.optional(),
    vlans: z
      .preprocess((raw, ctx) => {
        if (raw == null) return []
        const list = namedMapToList(/** @type {YamlValue} */ (raw), ctx, [])
        return list === z.NEVER ? z.NEVER : list
      }, z.array(vlanEntrySchema))
      .optional(),
  })
  .transform((n, ctx) => {
    const uplinks = n.uplinks ?? [{ name: 'eth0', dhcp4: true }]
    const uplinkNames = new Set(uplinks.map((u) => u.name))
    const defaultLink = uplinks.length === 1 ? uplinks[0].name : null
    const vlans = []
    const vlanRaw = n.vlans ?? []
    for (let i = 0; i < vlanRaw.length; i++) {
      const v = vlanRaw[i]
      let link = v.link
      if (!link) {
        if (!defaultLink) {
          ctx.addIssue({
            code: 'custom',
            message: 'link is required when more than one uplink is defined',
            path: ['vlans', v.name, 'link'],
          })
          return z.NEVER
        }
        link = defaultLink
      }
      if (uplinkNames.has(v.name)) {
        ctx.addIssue({
          code: 'custom',
          message:
            `${JSON.stringify(v.name)} collides with an uplink `
            + `(macvlan parent must be a VLAN iface, not the uplink)`,
          path: ['vlans', v.name],
        })
        return z.NEVER
      }
      if (!uplinkNames.has(link)) {
        ctx.addIssue({
          code: 'custom',
          message: `link ${JSON.stringify(link)} must match an uplinks key`,
          path: ['vlans', v.name, 'link'],
        })
        return z.NEVER
      }
      vlans.push({
        name: v.name,
        id: v.id,
        link,
        ipv4: v.ipv4 ?? null,
      })
    }
    return { ports: n.ports, uplinks, vlans }
  })

/**
 * Align proxmox.net map entries to uplink order; default missing NICs.
 * @param {{ name: string }[]} uplinks
 * @param {{ name: string | null, bridge: string, vlan: number | null, trunks: number[] | null, mac: string | null }[] | null | undefined} netList
 */
export function alignProxmoxNets(uplinks, netList) {
  const byName = new Map()
  for (const n of netList || []) {
    if (n.name) byName.set(n.name, n)
  }
  return uplinks.map((u) => {
    const hit = byName.get(u.name)
    if (hit) return { ...hit, name: u.name }
    return { name: u.name, ...DEFAULT_PROXMOX_NET }
  })
}
