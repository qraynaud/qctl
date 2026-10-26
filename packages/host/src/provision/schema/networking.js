/**
 * Provision `networking:` — ports + labeled interfaces (guest L3 + ethernet.vm host attach).
 */
import { z } from 'zod'

import { portsSchema } from '@qctl/shared'

import { BRIDGE_RE, IFACE_RE } from './zod-utils.js'

export { portsSchema }

export const INTERFACE_TYPE = Object.freeze({
  ETHERNET: 'ethernet',
  VLAN: 'vlan',
  DUMMY: 'dummy',
})

/** @typedef {typeof INTERFACE_TYPE[keyof typeof INTERFACE_TYPE]} InterfaceType */

export const VM_VLAN_MODE = Object.freeze({
  ACCESS: 'access',
  TRUNK: 'trunk',
})

/** @typedef {typeof VM_VLAN_MODE[keyof typeof VM_VLAN_MODE]} VmVlanMode */

/**
 * Host attach mode on `ethernet.vm` (one hypervisor NIC per ethernet with `vm`).
 * Hypervisor-agnostic: drivers map these to backend specifics (e.g. libvirt passt,
 * PVE bridge=). Omit `vm` → no hypervisor NIC.
 */
export const VM_ATTACH_MODE = Object.freeze({
  /** L2 attach to a named host bridge. */
  BRIDGE: 'bridge',
  /** Hypervisor userspace / NAT connectivity (no host bridge). */
  NAT: 'nat',
})

/** @typedef {typeof VM_ATTACH_MODE[keyof typeof VM_ATTACH_MODE]} VmAttachMode */

const vlanId = z.number().int().min(1).max(4094)
const labelKey = z.string().min(1)

/** Linux netdev name (`eth0`, `vlan2`, `foo_bar`) — not `z.hostname()` (rejects `_`). */
const ifaceName = z.stringFormat('linux-iface', IFACE_RE)
const bridgeName = z.stringFormat('linux-bridge', BRIDGE_RE)

/** Colon-delimited IEEE MAC; normalize to uppercase for hypervisors. */
const macAddress = z.mac().overwrite((mac) => mac.toUpperCase())

const ipv4Addr = z.ipv4()
const ipv4Cidr = z.cidrv4()
const ipv6Addr = z.ipv6()
const ipv6Cidr = z.cidrv6()
/** DNS / nameserver entry: address or hostname. */
const nameserver = z.union([z.ipv4(), z.ipv6(), z.hostname()])

/**
 * Scalar or list → non-empty string[].
 * @param {z.ZodType<string>} item
 */
function stringOrList(item) {
  return z.union([item, z.array(item).min(1)]).transform((v) => (Array.isArray(v) ? v : [v]))
}

const ipv4FamilySchema = z
  .strictObject({
    dhcp: z.boolean().default(false),
    addresses: stringOrList(ipv4Cidr).optional(),
    gateway: ipv4Addr.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.dhcp && (v.addresses?.length || v.gateway)) {
      ctx.addIssue({
        code: 'custom',
        message: 'ipv4.dhcp: true cannot be combined with addresses or gateway',
        path: ['dhcp'],
      })
    }
  })

const ipv6FamilySchema = z.strictObject({
  'accept-ra': z.boolean().default(false),
  addresses: stringOrList(ipv6Cidr).optional(),
  gateway: ipv6Addr.optional(),
})

/** Shared L3 on every interface type. */
const l3Fields = {
  ipv4: ipv4FamilySchema.optional(),
  ipv6: ipv6FamilySchema.optional(),
  nameservers: stringOrList(nameserver).optional(),
}

/** `"10-20"` → inclusive id list (no dedupe/sort here). */
const vlanRangeSchema = z
  .string()
  .regex(/^\d+-\d+$/)
  .transform(
    /** @returns {[unknown, unknown]} */ (s) => {
      const [from, to] = s.split('-')
      return [from, to]
    },
  )
  .pipe(
    z
      .tuple([z.coerce.number().int().min(1).max(4094), z.coerce.number().int().min(1).max(4094)])
      .refine(([from, to]) => from <= to, {
        message: 'bad vlan range (want from-to, 1–4094)',
      }),
  )
  .transform(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i))

/** One list entry → id list: `12` or `"10-20"`. */
const vlanIdOrRangeSchema = vlanRangeSchema.or(vlanId.transform((val) => [val]))

/**
 * Range or array → id list. Scalar `id` stays a separate arm so it can mean access
 * while `[id]` still means trunk.
 */
const vlanIdListSchema = z.union([
  vlanRangeSchema,
  z
    .array(vlanIdOrRangeSchema)
    .min(1)
    .transform((parts) => parts.flat()),
])

/**
 * `vm.vlan`: scalar id → access; range string or list → trunk.
 * @typedef {{ mode: VmVlanMode, ids: number[] }} VmVlan
 */
export const vmVlanSchema = z.union([
  vlanId.transform(/** @returns {VmVlan} */ (id) => ({ mode: VM_VLAN_MODE.ACCESS, ids: [id] })),
  vlanIdListSchema.transform(
    /** @returns {VmVlan} */ (ids) => ({
      mode: VM_VLAN_MODE.TRUNK,
      ids: [...new Set(ids)].sort((a, b) => a - b),
    }),
  ),
])

const ethernetVmMac = { mac: macAddress.optional() }

/**
 * Userspace / NAT attach — no host bridge.
 * Drivers map this (workstation → passt; Proxmox omits / unsupported).
 */
export const ethernetVmNatSchema = z.strictObject({
  mode: z.literal(VM_ATTACH_MODE.NAT),
  ...ethernetVmMac,
})

/** Bridge attach to a named host bridge. */
export const ethernetVmBridgeSchema = z.strictObject({
  mode: z.literal(VM_ATTACH_MODE.BRIDGE),
  bridge: bridgeName,
  vlan: vmVlanSchema.optional(),
  ...ethernetVmMac,
})

/**
 * Host attach for `type: ethernet`. Omit `vm` → no hypervisor NIC (guest L3 only /
 * dummies). Discriminated on required `mode`: `bridge` | `nat`.
 */
export const ethernetVmSchema = z.discriminatedUnion('mode', [
  ethernetVmNatSchema,
  ethernetVmBridgeSchema,
])

/**
 * Raw entry before label→iface default and type strip (deep-merge may leave stale keys).
 */
const interfaceEntryInSchema = z.strictObject({
  type: z
    .enum([INTERFACE_TYPE.ETHERNET, INTERFACE_TYPE.VLAN, INTERFACE_TYPE.DUMMY])
    .default(INTERFACE_TYPE.ETHERNET),
  iface: ifaceName.optional(),
  id: vlanId.optional(),
  parent: labelKey.optional(),
  vm: ethernetVmSchema.optional(),
  ...l3Fields,
})

/**
 * @typedef {object} InterfaceEthernet
 * @property {'ethernet'} type
 * @property {string} iface
 * @property {z.infer<typeof ipv4FamilySchema>} [ipv4]
 * @property {z.infer<typeof ipv6FamilySchema>} [ipv6]
 * @property {string[]} [nameservers]
 * @property {z.infer<typeof ethernetVmSchema>} [vm]
 */

/**
 * @typedef {object} InterfaceVlan
 * @property {'vlan'} type
 * @property {string} iface
 * @property {number} id
 * @property {string} parent
 * @property {z.infer<typeof ipv4FamilySchema>} [ipv4]
 * @property {z.infer<typeof ipv6FamilySchema>} [ipv6]
 * @property {string[]} [nameservers]
 */

/**
 * @typedef {object} InterfaceDummy
 * @property {'dummy'} type
 * @property {string} iface
 * @property {z.infer<typeof ipv4FamilySchema>} [ipv4]
 * @property {z.infer<typeof ipv6FamilySchema>} [ipv6]
 * @property {string[]} [nameservers]
 */

/** @typedef {InterfaceEthernet | InterfaceVlan | InterfaceDummy} InterfaceEntry */

/**
 * Normalize one map entry: iface default, keep only fields valid for `type`.
 * @param {string} label
 * @param {z.infer<typeof interfaceEntryInSchema>} raw
 * @returns {InterfaceEntry | { error: string, path?: (string|number)[] }}
 */
export function normalizeInterfaceEntry(label, raw) {
  const type = raw.type ?? INTERFACE_TYPE.ETHERNET
  const iface = raw.iface ?? (IFACE_RE.test(label) ? label : undefined)
  if (!iface) {
    return {
      error: 'iface is required when the label is not a valid Linux interface name',
      path: ['iface'],
    }
  }

  /** @type {{ ipv4?: typeof raw.ipv4, ipv6?: typeof raw.ipv6, nameservers?: string[] }} */
  const l3 = {}
  if (raw.ipv4) l3.ipv4 = raw.ipv4
  if (raw.ipv6) l3.ipv6 = raw.ipv6
  if (raw.nameservers) l3.nameservers = raw.nameservers

  if (type === INTERFACE_TYPE.ETHERNET) {
    return {
      type: INTERFACE_TYPE.ETHERNET,
      iface,
      ...l3,
      ...(raw.vm ? { vm: raw.vm } : {}),
    }
  }

  if (type === INTERFACE_TYPE.VLAN) {
    if (raw.id == null) {
      return { error: 'id is required for type: vlan', path: ['id'] }
    }
    if (!raw.parent) {
      return { error: 'parent is required for type: vlan', path: ['parent'] }
    }
    return {
      type: INTERFACE_TYPE.VLAN,
      iface,
      id: raw.id,
      parent: raw.parent,
      ...l3,
    }
  }

  // dummy — strip id/parent/vm left by type flips after deep-merge
  return {
    type: INTERFACE_TYPE.DUMMY,
    iface,
    ...l3,
  }
}

/**
 * @param {Record<string, InterfaceEntry>} interfaces
 * @returns {[string, InterfaceEthernet][]}
 */
export function ethernetEntries(interfaces) {
  return Object.entries(interfaces)
    .filter(([, e]) => e.type === INTERFACE_TYPE.ETHERNET)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, e]) => [label, /** @type {InterfaceEthernet} */ (e)])
}

/**
 * @param {Record<string, InterfaceEntry>} interfaces
 * @returns {[string, InterfaceVlan][]}
 */
export function vlanEntries(interfaces) {
  return Object.entries(interfaces)
    .filter(([, e]) => e.type === INTERFACE_TYPE.VLAN)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, e]) => [label, /** @type {InterfaceVlan} */ (e)])
}

/**
 * Dummy iface names (kernel names), sorted.
 * @param {Record<string, InterfaceEntry>} interfaces
 * @returns {string[]}
 */
export function dummyInterfaceNames(interfaces) {
  return Object.values(interfaces)
    .filter((e) => e.type === INTERFACE_TYPE.DUMMY)
    .map((e) => e.iface)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Resolve vlan `parent` label → parent ethernet iface name.
 * @param {Record<string, InterfaceEntry>} interfaces
 * @param {string} parentLabel
 * @returns {string | undefined}
 */
export function resolveParentIface(interfaces, parentLabel) {
  const e = interfaces[parentLabel]
  if (!e || e.type !== INTERFACE_TYPE.ETHERNET) return undefined
  return e.iface
}

/**
 * @typedef {object} AlignedVmNic
 * @property {string} label
 * @property {string} iface
 * @property {z.infer<typeof ethernetVmSchema>} [vm]
 */

/**
 * Ethernet NICs for hypervisor drivers — sorted by label.
 * @param {Record<string, InterfaceEntry>} interfaces
 * @returns {AlignedVmNic[]}
 */
export function alignedVmNics(interfaces) {
  return ethernetEntries(interfaces).map(([label, e]) => ({
    label,
    iface: e.iface,
    ...(e.vm ? { vm: e.vm } : {}),
  }))
}

export const interfacesSchema = z
  .record(labelKey, interfaceEntryInSchema)
  .transform((map, ctx) => {
    /** @type {Record<string, InterfaceEntry>} */
    const out = {}
    for (const [label, raw] of Object.entries(map)) {
      const normalized = normalizeInterfaceEntry(label, raw)
      if ('error' in normalized) {
        ctx.addIssue({
          code: 'custom',
          message: normalized.error,
          path: [label, ...(normalized.path ?? [])],
        })
        continue
      }
      out[label] = normalized
    }
    return out
  })
  .superRefine((interfaces, ctx) => {
    const labels = Object.keys(interfaces)
    if (!labels.some((l) => interfaces[l].type === INTERFACE_TYPE.ETHERNET)) {
      ctx.addIssue({
        code: 'custom',
        message: 'interfaces must include at least one type: ethernet',
        path: [],
      })
    }

    /** @type {Map<string, string>} */
    const ifaceOwners = new Map()
    for (const [label, e] of Object.entries(interfaces)) {
      const prev = ifaceOwners.get(e.iface)
      if (prev) {
        ctx.addIssue({
          code: 'custom',
          message: `iface ${JSON.stringify(e.iface)} already used by label ${JSON.stringify(prev)}`,
          path: [label, 'iface'],
        })
      } else {
        ifaceOwners.set(e.iface, label)
      }

      if (e.type === INTERFACE_TYPE.VLAN) {
        const parent = interfaces[e.parent]
        if (!parent) {
          ctx.addIssue({
            code: 'custom',
            message: `parent ${JSON.stringify(e.parent)} must match an interfaces label`,
            path: [label, 'parent'],
          })
        } else if (parent.type !== INTERFACE_TYPE.ETHERNET) {
          ctx.addIssue({
            code: 'custom',
            message: `parent ${JSON.stringify(e.parent)} must be type: ethernet`,
            path: [label, 'parent'],
          })
        }
      }
    }
  })
  .prefault({
    main: { type: INTERFACE_TYPE.ETHERNET, iface: 'eth0' },
  })

export const networkingSchema = z.strictObject({
  ports: portsSchema,
  interfaces: interfacesSchema,
})
