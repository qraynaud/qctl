/**
 * Guest-facing interface map on the seed ISO — same shape as provision
 * `networking.interfaces`, without host-only `ethernet.vm`.
 */
import { z } from 'zod'

export const SEED_IFACE_TYPE = Object.freeze({
  ETHERNET: 'ethernet',
  VLAN: 'vlan',
  DUMMY: 'dummy',
})

/** @typedef {typeof SEED_IFACE_TYPE[keyof typeof SEED_IFACE_TYPE]} SeedIfaceType */

const nonEmpty = z
  .string()
  .min(1)
  .refine((s) => s === s.trim(), { message: 'must not have leading or trailing whitespace' })

const ipv4Family = z.strictObject({
  dhcp: z.boolean(),
  addresses: z.array(z.string()).optional(),
  gateway: z.string().optional(),
})

const ipv6Family = z.strictObject({
  'accept-ra': z.boolean(),
  addresses: z.array(z.string()).optional(),
  gateway: z.string().optional(),
})

const l3Fields = {
  ipv4: ipv4Family.optional(),
  ipv6: ipv6Family.optional(),
  nameservers: z.array(z.string()).optional(),
}

export const seedInterfaceEthernetSchema = z.strictObject({
  type: z.literal(SEED_IFACE_TYPE.ETHERNET),
  iface: nonEmpty,
  ...l3Fields,
})

export const seedInterfaceVlanSchema = z.strictObject({
  type: z.literal(SEED_IFACE_TYPE.VLAN),
  iface: nonEmpty,
  id: z.number().int().min(1).max(4094),
  parent: nonEmpty,
  ...l3Fields,
})

export const seedInterfaceDummySchema = z.strictObject({
  type: z.literal(SEED_IFACE_TYPE.DUMMY),
  iface: nonEmpty,
  ...l3Fields,
})

export const seedInterfaceEntrySchema = z.discriminatedUnion('type', [
  seedInterfaceEthernetSchema,
  seedInterfaceVlanSchema,
  seedInterfaceDummySchema,
])

export const seedInterfacesSchema = z.record(nonEmpty, seedInterfaceEntrySchema)

/**
 * Parent ethernet iface for a vlan `parent` label, or undefined.
 * @param {z.infer<typeof seedInterfacesSchema>} interfaces
 * @param {string} parentLabel
 * @returns {string | undefined}
 */
export function resolveParentIface(interfaces, parentLabel) {
  const p = interfaces[parentLabel]
  if (!p || p.type !== SEED_IFACE_TYPE.ETHERNET) return undefined
  return p.iface
}

/**
 * Ethernet then vlan entries (dummy omitted), each group sorted by iface.
 * @param {z.infer<typeof seedInterfacesSchema>} interfaces
 * @returns {Array<[string, Exclude<z.infer<typeof seedInterfaceEntrySchema>, { type: 'dummy' }>]>}
 */
export function applyableInterfaceEntries(interfaces) {
  /** @type {Array<[string, z.infer<typeof seedInterfaceEthernetSchema>]>} */
  const ethernets = []
  /** @type {Array<[string, z.infer<typeof seedInterfaceVlanSchema>]>} */
  const vlans = []
  for (const [label, e] of Object.entries(interfaces)) {
    if (e.type === SEED_IFACE_TYPE.ETHERNET) ethernets.push([label, e])
    else if (e.type === SEED_IFACE_TYPE.VLAN) vlans.push([label, e])
  }
  const byIface = (
    /** @type {[string, { iface: string }]} */ a,
    /** @type {[string, { iface: string }]} */ b,
  ) => a[1].iface.localeCompare(b[1].iface)
  return [...ethernets.sort(byIface), ...vlans.sort(byIface)]
}

/**
 * Dummy iface names from seed/provision interfaces map, sorted.
 * @param {z.infer<typeof seedInterfacesSchema>} interfaces
 * @returns {string[]}
 */
export function dummyIfaceNames(interfaces) {
  return Object.values(interfaces)
    .filter((e) => e.type === SEED_IFACE_TYPE.DUMMY)
    .map((e) => e.iface)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Quadlet / seed sidecar keys: `VLAN{n}_PARENT` | `VLAN{n}_IPV4`
 * (`n` from label `vlan{n}`; PARENT value is **iface**).
 * @param {string} key
 * @returns {boolean}
 */
export function isVlanParentEnvKey(key) {
  return /^VLAN\d+_(PARENT|IPV4)$/.test(key)
}

/**
 * Podman / host VLAN env from interface **labels** matching `^vlan(\d+)$`.
 * `VLAN{n}_PARENT=<iface>` (not the label); optional `VLAN{n}_IPV4` from ipv4.addresses.
 * @param {z.infer<typeof seedInterfacesSchema>} interfaces
 * @returns {string[]}
 */
export function vlanParentEnvLines(interfaces) {
  const lines = []
  for (const [label, e] of Object.entries(interfaces)) {
    const m = /^vlan(\d+)$/i.exec(label)
    if (!m) continue
    lines.push(`VLAN${m[1]}_PARENT=${e.iface}`)
    const raw = e.ipv4?.addresses?.[0]
    if (raw) {
      const slash = raw.indexOf('/')
      const host = slash >= 0 ? raw.slice(0, slash) : raw
      lines.push(`VLAN${m[1]}_IPV4=${host}`)
    }
  }
  return lines.sort((a, b) => a.localeCompare(b))
}

/**
 * Env map for vlan-parents.env / SeedConfig sidecars.
 * @param {z.infer<typeof seedInterfacesSchema>} interfaces
 * @returns {Record<string, string>}
 */
export function vlanParentsFromInterfaces(interfaces) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of vlanParentEnvLines(interfaces)) {
    const i = line.indexOf('=')
    if (i <= 0) continue
    out[line.slice(0, i)] = line.slice(i + 1)
  }
  return out
}
