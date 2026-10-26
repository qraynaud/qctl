/**
 * Proxmox cross-field provision checks (ethernet.vm trunk ↔ guest vlans).
 * Owned by the proxmox driver — not core provision parse.
 *
 * Trunk: every guest `type: vlan` on that parent must have `id` ∈ `vm.vlan.ids`.
 * Access (scalar vm.vlan): guest vlans allowed (double-tag).
 * No `vm.vlan` / omitted `vm` / non-bridge `vm.mode`: no carriage check.
 */
import { VM_ATTACH_MODE, VM_VLAN_MODE, vlanEntries } from '../../../provision/schema/networking.js'

/** @import { z } from 'zod' */
/** @import { ProvisionBody } from '../../../provision/schema/parse.js' */

/**
 * @param {ProvisionBody} data
 * @param {z.RefinementCtx} ctx
 * @returns {void}
 */
export function refineProvision(data, ctx) {
  const interfaces = data.networking.interfaces

  for (const [label, vlan] of vlanEntries(interfaces)) {
    const parent = interfaces[vlan.parent]
    if (parent?.type !== 'ethernet') continue

    const parentVm = parent.vm
    if (!parentVm || parentVm.mode !== VM_ATTACH_MODE.BRIDGE) continue
    const vmVlan = parentVm.vlan
    if (!vmVlan || vmVlan.mode !== VM_VLAN_MODE.TRUNK) continue

    if (!vmVlan.ids.includes(vlan.id)) {
      ctx.addIssue({
        code: 'custom',
        message:
          `interfaces.${label}.id ${vlan.id} is not carried on parent `
          + `${JSON.stringify(vlan.parent)} trunk `
          + `(vm.vlan ids: ${vmVlan.ids.join(', ')})`,
        path: ['networking', 'interfaces', label, 'id'],
      })
    }
  }
}
