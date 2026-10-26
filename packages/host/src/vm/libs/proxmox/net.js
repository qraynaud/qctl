/**
 * Proxmox net0/netN value helpers (from `ethernet.vm` / {@link AlignedVmNic} / {@link VmNicsSpec}).
 */
import { VM_ATTACH_MODE, VM_VLAN_MODE } from '../../../provision/schema/networking.js'

/** @import { VmNicBridgeSpec, VmNicsSpec } from '../../driver-contract.js' */
/** @import { AlignedVmNic, EthernetVm, QemuConfig } from './types.js' */

/** Bridge host-attach fields used to build a PVE `netN` string. */
/** @typedef {Extract<EthernetVm, { mode: 'bridge' }>} NetIface */

/**
 * {@link VmNicsSpec} → sorted {@link AlignedVmNic}[] (label → net0, net1, …).
 * Only `mode: bridge` entries (Proxmox has no userspace/NAT NIC); `nat` omitted.
 * @param {VmNicsSpec | null | undefined} nics
 * @returns {AlignedVmNic[]}
 */
export function nicsSpecToAligned(nics) {
  return Object.entries(nics || {})
    .filter(
      /** @returns {entry is [string, VmNicBridgeSpec]} */ (entry) =>
        entry[1].mode === VM_ATTACH_MODE.BRIDGE,
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, n]) => ({
      label,
      iface: n.iface,
      vm: {
        mode: /** @type {typeof VM_ATTACH_MODE.BRIDGE} */ (VM_ATTACH_MODE.BRIDGE),
        bridge: n.bridge,
        ...(n.mac ? { mac: n.mac } : {}),
        ...(n.vlan ? { vlan: n.vlan } : {}),
      },
    }))
}

/**
 * @param {AlignedVmNic | NetIface | Partial<NetIface>} n
 * @returns {NetIface}
 */
function asNetIface(n) {
  const raw = 'label' in n ? n.vm : n
  if (!raw || raw.mode === VM_ATTACH_MODE.NAT) {
    throw new Error('formatNet: expected mode: bridge host attach')
  }
  if (!('bridge' in raw) || !raw.bridge) {
    throw new Error('formatNet: bridge name required')
  }
  return {
    mode: VM_ATTACH_MODE.BRIDGE,
    bridge: raw.bridge,
    ...('mac' in raw && raw.mac ? { mac: raw.mac } : {}),
    ...('vlan' in raw && raw.vlan ? { vlan: raw.vlan } : {}),
  }
}

/**
 * @param {string | null | undefined} raw
 * @returns {string | null} normalized AA:BB:CC:DD:EE:FF or null if not a MAC
 */
export function normalizeMac(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  /** @type {string} */
  let hex
  if (/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(s)) {
    hex = s.replace(/[:-]/g, '')
  } else if (/^[0-9A-Fa-f]{12}$/.test(s)) {
    hex = s
  } else {
    return null
  }
  return (hex.match(/.{2}/g) ?? []).map((p) => p.toUpperCase()).join(':')
}

/**
 * Compact VLAN list for display: 10,20,30-40
 * @param {number[] | null | undefined} ids
 * @returns {string}
 */
export function summarizeVlans(ids) {
  if (!ids?.length) return ''
  const sorted = [...ids].sort((a, b) => a - b)
  /** @type {string[]} */
  const parts = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i]
    if (cur === prev + 1) {
      prev = cur
      continue
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`)
    start = cur
    prev = cur
  }
  return parts.join(',')
}

/**
 * Build one PVE netN value from ethernet.vm (or flat NetIface).
 * @param {AlignedVmNic | NetIface | Partial<NetIface>} iface
 * @returns {string}
 */
export function formatNet(iface) {
  const n = asNetIface(iface)
  const mac = n.mac ? normalizeMac(n.mac) : null
  let net = mac ? `virtio=${mac},bridge=${n.bridge}` : `virtio,bridge=${n.bridge}`
  if (n.vlan?.mode === VM_VLAN_MODE.TRUNK && n.vlan.ids.length) {
    net += `,trunks=${n.vlan.ids.join(';')}`
  } else if (n.vlan?.mode === VM_VLAN_MODE.ACCESS && n.vlan.ids[0] != null) {
    net += `,tag=${n.vlan.ids[0]}`
  }
  return net
}

/**
 * Assign net0..netN on a PVE create/config form (array order = slot order).
 * Empty / omitted list → no host NICs (caller deletes surplus netN).
 * @param {QemuConfig} form
 * @param {(AlignedVmNic | NetIface | Partial<NetIface>)[] | null | undefined} nets
 * @returns {number}
 */
export function applyNetsToForm(form, nets) {
  const list = nets || []
  for (let i = 0; i < list.length; i++) {
    form[`net${i}`] = formatNet(list[i])
  }
  return list.length
}

/**
 * Apply {@link VmNicsSpec} (sorted by label) to a PVE form.
 * @param {QemuConfig} form
 * @param {VmNicsSpec | null | undefined} nics
 * @returns {number}
 */
export function applyNicsSpecToForm(form, nics) {
  return applyNetsToForm(form, nicsSpecToAligned(nics))
}

/**
 * @param {AlignedVmNic | NetIface | Partial<NetIface>} iface
 * @returns {string}
 */
export function formatNetLabel(iface) {
  const n = asNetIface(iface)
  /** @type {string} */
  let base
  if (n.vlan?.mode === VM_VLAN_MODE.TRUNK && n.vlan.ids.length) {
    base = `bridge ${n.bridge} trunk [${summarizeVlans(n.vlan.ids)}]`
  } else if (n.vlan?.mode === VM_VLAN_MODE.ACCESS && n.vlan.ids[0] != null) {
    base = `bridge ${n.bridge} vlan ${n.vlan.ids[0]}`
  } else {
    base = `bridge ${n.bridge} (untagged)`
  }
  return n.mac ? `${base} mac ${normalizeMac(n.mac) || n.mac}` : base
}

/**
 * @param {(AlignedVmNic | NetIface | Partial<NetIface>)[] | null | undefined} nets
 * @returns {string}
 */
export function formatNetsLabel(nets) {
  if (!nets?.length) return 'no host NICs'
  if (nets.length === 1) return formatNetLabel(nets[0])
  return nets.map((n, i) => `net${i}: ${formatNetLabel(n)}`).join('; ')
}

/**
 * If desired has no virtio=MAC, keep MAC from existing PVE net value.
 * @param {string | number | boolean | null | undefined} existingNet
 * @param {string} desiredNet
 * @returns {string}
 */
export function mergeNetPreserveMac(existingNet, desiredNet) {
  if (/^virtio=/i.test(desiredNet)) return desiredNet
  const mac = String(existingNet || '').match(
    /(?:^|,)(?:virtio|e1000|e1000e|rtl8139|vmxnet3)=([0-9A-Fa-f:]+)/i,
  )?.[1]
  if (!mac) return desiredNet
  if (/^virtio,/i.test(desiredNet)) return desiredNet.replace(/^virtio,/i, `virtio=${mac},`)
  return desiredNet
}
