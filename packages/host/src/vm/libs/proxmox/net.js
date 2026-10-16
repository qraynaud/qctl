/**
 * Proxmox net0/netN value helpers.
 */

/** @import { ProxmoxNet, QemuConfig } from './types.js' */

/** @typedef {Partial<ProxmoxNet>} NetIface */

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
 * Build one PVE netN value from a normalized iface.
 * @param {NetIface} [iface]
 * @returns {string}
 */
export function formatNet(iface = {}) {
  const bridge = iface.bridge || 'vmbr0'
  const mac = iface.mac ? normalizeMac(iface.mac) : null
  let net = mac ? `virtio=${mac},bridge=${bridge}` : `virtio,bridge=${bridge}`
  if (iface.trunks?.length) net += `,trunks=${iface.trunks.join(';')}`
  else if (iface.vlan) net += `,tag=${iface.vlan}`
  return net
}

/**
 * Assign net0..netN on a PVE create/config form.
 * @param {QemuConfig} form
 * @param {NetIface[] | null | undefined} nets
 * @returns {number}
 */
export function applyNetsToForm(form, nets) {
  const list = nets?.length ? nets : [{ bridge: 'vmbr0' }]
  for (let i = 0; i < list.length; i++) {
    form[`net${i}`] = formatNet(list[i])
  }
  return list.length
}

/**
 * @param {NetIface} [iface]
 * @returns {string}
 */
export function formatNetLabel(iface = {}) {
  const bridge = iface.bridge || 'vmbr0'
  /** @type {string} */
  let base
  if (iface.trunks?.length) {
    base = `bridge ${bridge} trunk [${summarizeVlans(iface.trunks)}]`
  } else if (iface.vlan) {
    base = `bridge ${bridge} vlan ${iface.vlan}`
  } else {
    base = `bridge ${bridge} (untagged)`
  }
  return iface.mac ? `${base} mac ${normalizeMac(iface.mac) || iface.mac}` : base
}

/**
 * @param {NetIface[] | null | undefined} nets
 * @returns {string}
 */
export function formatNetsLabel(nets) {
  if (!nets?.length) return formatNetLabel({})
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
