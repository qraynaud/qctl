/**
 * Workstation virt-install / libvirt NIC args from {@link VmNicsSpec}.
 * Provision modes are hypervisor-agnostic; this module maps them to libvirt:
 * `bridge` → `--network bridge=…`; `nat` → passt userspace.
 */

import { virtInstallPasstNetworkArg } from '../../lib/ports.js'
import { VM_ATTACH_MODE } from '../../provision/schema/networking.js'
import { nicsSorted } from './nic-plan.js'

/** @import { VmNicBridgeSpec, VmNicSpec, VmNicsSpec } from '../driver-contract.js' */
/** @import { PortsMap } from '../types.js' */

/**
 * Sanitize provision label for libvirt user alias (`ua-…`).
 * @param {string} label
 * @returns {string}
 */
export function libvirtNicAlias(label) {
  const raw = String(label || '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const body = raw || 'nic'
  return `ua-${body}`.slice(0, 80)
}

/**
 * One virt-install `--network` value for a bridged NIC.
 * @param {string} label
 * @param {VmNicBridgeSpec} n
 * @returns {string}
 */
export function virtInstallBridgeNetworkArg(label, n) {
  /** @type {string[]} */
  const parts = [`bridge=${n.bridge}`, 'model=virtio']
  if (n.mac) parts.push(`mac=${n.mac}`)
  // Guest iface rename is seed-side; target= is the host tap name hint when supported.
  if (n.iface) parts.push(`target=${n.iface}`)
  void label
  return parts.join(',')
}

/**
 * One virt-install `--network` value for NAT / userspace (passt).
 * @param {VmNicSpec} n
 * @param {PortsMap} ports
 * @returns {string}
 */
export function virtInstallNatNetworkArg(n, ports) {
  let arg = virtInstallPasstNetworkArg(ports)
  if (n.mac) arg += `,mac=${n.mac}`
  return arg
}

/**
 * `--network` argv pairs from NIC plan (label order).
 * Empty / missing plan → one NAT (passt) NIC so virt-install still has a network.
 *
 * @param {{
 *   nics?: VmNicsSpec | null,
 *   ports: PortsMap,
 * }} opts
 * @returns {string[]} flat argv fragments including `--network` keys
 */
export function virtInstallNetworkArgv(opts) {
  const sorted = nicsSorted(opts.nics)
  /** @type {string[]} */
  const out = []
  if (!sorted.length) {
    out.push('--network', virtInstallPasstNetworkArg(opts.ports))
    return out
  }
  for (const [label, n] of sorted) {
    if (n.mode === VM_ATTACH_MODE.BRIDGE) {
      out.push('--network', virtInstallBridgeNetworkArg(label, n))
    } else if (n.mode === VM_ATTACH_MODE.NAT) {
      out.push('--network', virtInstallNatNetworkArg(n, opts.ports))
    }
  }
  return out
}

/**
 * Inject `<alias name='ua-LABEL'/>` into domain interface blocks (libvirt user aliases).
 * Order matches sorted labels that produced a hypervisor NIC. Skips blocks that
 * already have an alias.
 *
 * @param {string} xml
 * @param {string[]} labelsInOrder
 * @returns {string}
 */
export function injectInterfaceAliases(xml, labelsInOrder) {
  if (!labelsInOrder.length) return xml
  let i = 0
  return xml.replace(/<interface\b[^>]*>[\s\S]*?<\/interface>/gi, (block) => {
    const label = labelsInOrder[i++]
    if (!label) return block
    if (/<alias\b/i.test(block)) return block
    const alias = libvirtNicAlias(label)
    return block.replace(/<\/interface>/i, `  <alias name='${alias}'/>\n  </interface>`)
  })
}
