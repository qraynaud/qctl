/**
 * Map provision `networking.interfaces` → {@link VmNicsSpec} for drivers.
 * Same idea as {@link ./disk-plan.js}: host builds the plan; driver applies it.
 *
 * Only ethernet entries **with** `vm` become hypervisor NICs (explicit attach mode).
 */
import { VM_ATTACH_MODE, alignedVmNics } from '../../provision/schema/networking.js'

/** @import { Networking } from '../../provision/schema/types.js' */
/** @import { VmNicBridgeSpec, VmNicSpec, VmNicsSpec } from '../driver-contract.js' */

/**
 * Ethernet + `vm` → labeled NIC plan (driver sorts labels for attach order).
 *
 * @param {Networking['interfaces'] | undefined} interfaces
 * @returns {VmNicsSpec}
 */
export function toVmNicsSpec(interfaces) {
  /** @type {VmNicsSpec} */
  const out = {}
  for (const { label, iface, vm } of alignedVmNics(interfaces || {})) {
    if (!vm) continue
    if (vm.mode === VM_ATTACH_MODE.BRIDGE) {
      /** @type {VmNicSpec} */
      const nic = {
        iface,
        mode: VM_ATTACH_MODE.BRIDGE,
        bridge: vm.bridge,
        ...(vm.vlan ? { vlan: vm.vlan } : {}),
        ...(vm.mac ? { mac: vm.mac } : {}),
      }
      out[label] = nic
    } else {
      /** @type {VmNicSpec} */
      const nic = {
        iface,
        mode: VM_ATTACH_MODE.NAT,
        ...(vm.mac ? { mac: vm.mac } : {}),
      }
      out[label] = nic
    }
  }
  return out
}

/**
 * NICs sorted by label (hypervisor attach order).
 * @param {VmNicsSpec | null | undefined} nics
 * @returns {Array<[string, VmNicSpec]>}
 */
export function nicsSorted(nics) {
  return Object.entries(nics || {}).sort(([a], [b]) => a.localeCompare(b))
}

/**
 * Bridged NICs only, sorted by label.
 * @param {VmNicsSpec | null | undefined} nics
 * @returns {Array<[string, VmNicBridgeSpec]>}
 */
export function bridgedNicsSorted(nics) {
  /** @type {Array<[string, VmNicBridgeSpec]>} */
  const out = []
  for (const [label, n] of nicsSorted(nics)) {
    if (n.mode !== VM_ATTACH_MODE.BRIDGE) continue
    out.push([label, n])
  }
  return out
}

/**
 * Whether any NIC uses userspace / NAT attach.
 * @param {VmNicsSpec | null | undefined} nics
 * @returns {boolean}
 */
export function hasNatNic(nics) {
  return nicsSorted(nics).some(([, n]) => n.mode === VM_ATTACH_MODE.NAT)
}

/**
 * SSH / sync reachability from NIC plan (no CLI override).
 * Any `nat` or empty plan → passt (`user`); bridge-only → DHCP (`default`).
 *
 * @param {VmNicsSpec | null | undefined} nics
 * @returns {'user' | 'default'}
 */
export function endpointNetworkFromNics(nics) {
  if (!nics || !Object.keys(nics).length) return 'user'
  if (hasNatNic(nics)) return 'user'
  return 'default'
}
