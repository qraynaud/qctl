import { z } from 'zod'

import { portsSchema } from '@qctl/shared'

import { BRIDGE_RE, IFACE_RE } from './zod-utils.js'

/** @import { AlignedProxmoxNet, ProxmoxNetMap } from './types.js' */

export { portsSchema }

const vlanId = z.number().int().min(1).max(4094)
const ifaceName = z.string().trim().min(1).regex(IFACE_RE, 'must be a Linux interface name')
const mapKey = z.string().trim().min(1)

/** One trunk entry → VLAN id list: `12` or `"10-20"` (inclusive range). */
const trunkEntrySchema = z
  .string()
  .trim()
  .regex(/^\d+-\d+$/)
  .transform(
    /** @returns {[unknown, unknown]} intermediate strings before coerce.number */ (s) => {
      const [from, to] = s.split('-')
      return [from, to]
    },
  )
  .pipe(
    z
      .tuple([z.coerce.number().int().min(1).max(4094), z.coerce.number().int().min(1).max(4094)])
      .refine(([from, to]) => from <= to, {
        message: 'bad trunk range (want from-to, 1–4094)',
      }),
  )
  .transform(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i))
  .or(vlanId.transform((id) => [id]))

/**
 * Trunks field: scalar or list of ids/ranges → sorted unique VLAN ids.
 */
export const trunksSchema = z
  .array(trunkEntrySchema)
  .min(1)
  .or(trunkEntrySchema)
  .transform((parts) => [...new Set(parts.flat())].sort((a, b) => a - b))
  .optional()

/** Default hypervisor NIC when proxmox.net is omitted (keyed like uplinks). */
export const DEFAULT_PROXMOX_NET = Object.freeze({
  bridge: 'vmbr0',
})

export const uplinkSchema = z.strictObject({
  dhcp4: z.boolean().default(true),
})

export const uplinksSchema = z
  .record(ifaceName, uplinkSchema)
  .refine((uplinks) => Object.values(uplinks).length >= 1, {
    message: 'uplinks must be a non-empty map',
  })
  .prefault({ eth0: {} })

/** Optional host address on this VLAN (Scale macvlan2 / host↔macvlan peers). */
const ipv4Addr = z
  .string()
  .trim()
  .regex(
    /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
    'must be an IPv4 address',
  )

const vlanEntrySchema = z.strictObject({
  id: vlanId,
  link: ifaceName.optional(),
  ipv4: ipv4Addr.optional(),
})

/** Colon-delimited IEEE MAC; store uppercase for Proxmox. */
const proxmoxMac = z.mac().transform((mac) => mac.toUpperCase())

export const proxmoxNetEntrySchema = z
  .strictObject({
    bridge: z.string().trim().regex(BRIDGE_RE, 'must be a Linux bridge name'),
    tag: vlanId.optional(),
    vlan: vlanId.optional(),
    trunks: trunksSchema,
    mac: proxmoxMac.optional(),
  })
  .refine((raw) => !(raw.tag ?? raw.vlan) || !raw.trunks?.length, {
    message: 'set tag/vlan OR trunks, not both',
    path: ['trunks'],
  })
  .transform((raw) => {
    const vlan = raw.tag ?? raw.vlan
    return {
      bridge: raw.bridge,
      ...(vlan ? { vlan } : {}),
      ...(raw.trunks ? { trunks: raw.trunks } : {}),
      ...(raw.mac ? { mac: raw.mac } : {}),
    }
  })

/**
 * proxmox.net: map keyed by uplink name.
 * Omit → undefined (caller fills defaults from uplinks via {@link alignProxmoxNets}).
 */
export const proxmoxNetMapSchema = z
  .record(mapKey, proxmoxNetEntrySchema)
  .refine((net) => Object.values(net).length >= 1, {
    message: 'proxmox.net must be a non-empty map',
  })

export const networkingSchema = z
  .strictObject({
    ports: portsSchema,
    uplinks: uplinksSchema,
    vlans: z.record(ifaceName, vlanEntrySchema).prefault({}),
  })
  .transform((n) => {
    const uplinkKeys = Object.keys(n.uplinks)
    const defaultLink = uplinkKeys.length === 1 ? uplinkKeys[0] : undefined
    /** @type {Record<string, { id: number, link?: string, ipv4?: string }>} */
    const vlans = {}
    for (const [name, v] of Object.entries(n.vlans)) {
      const link = v.link ?? defaultLink
      vlans[name] = {
        id: v.id,
        ...(link ? { link } : {}),
        ...(v.ipv4 ? { ipv4: v.ipv4 } : {}),
      }
    }
    return { ports: n.ports, uplinks: n.uplinks, vlans }
  })
  .superRefine((n, ctx) => {
    const uplinkNames = new Set(Object.keys(n.uplinks))
    for (const [name, v] of Object.entries(n.vlans)) {
      if (!v.link) {
        ctx.addIssue({
          code: 'custom',
          message: 'link is required when more than one uplink is defined',
          path: ['vlans', name, 'link'],
        })
        continue
      }
      if (uplinkNames.has(name)) {
        ctx.addIssue({
          code: 'custom',
          message:
            `${JSON.stringify(name)} collides with an uplink `
            + `(macvlan parent must be a VLAN iface, not the uplink)`,
          path: ['vlans', name],
        })
      }
      if (!uplinkNames.has(v.link)) {
        ctx.addIssue({
          code: 'custom',
          message: `link ${JSON.stringify(v.link)} must match an uplinks key`,
          path: ['vlans', name, 'link'],
        })
      }
    }
  })

/**
 * Align proxmox.net map entries to uplink order; default missing NICs.
 * @param {Record<string, { dhcp4: boolean }>} uplinks
 * @param {ProxmoxNetMap | null | undefined} netMap
 * @returns {AlignedProxmoxNet[]}
 */
export function alignProxmoxNets(uplinks, netMap) {
  return Object.keys(uplinks).map((name) => {
    const hit = netMap?.[name]
    if (hit) return { ...hit, name }
    return { name, ...DEFAULT_PROXMOX_NET }
  })
}
