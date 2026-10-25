/**
 * Proxmox cross-field provision checks (uplinks ↔ proxmox.net / VLAN carriage).
 * Owned by the proxmox driver — not core provision parse.
 */
import { z } from 'zod'

import { alignProxmoxNets } from '../../../provision/schema/networking.js'

/** @import { ProvisionBody } from '../../../provision/schema/parse.js' */

/**
 * @param {ProvisionBody} data
 * @returns {boolean}
 */
function proxmoxNetNamesMatchUplinks(data) {
  if (!data.proxmox?.net) return true
  const uplinkNames = new Set(Object.keys(data.networking.uplinks))
  return Object.keys(data.proxmox.net).every((name) => uplinkNames.has(name))
}

/**
 * @param {ProvisionBody} data
 * @returns {boolean}
 */
function everyUplinkHasProxmoxNet(data) {
  if (!data.proxmox?.net) return true
  const netNames = new Set(Object.keys(data.proxmox.net))
  return Object.keys(data.networking.uplinks).every((name) => netNames.has(name))
}

/**
 * @param {ProvisionBody} data
 * @returns {boolean}
 */
function vlansCarriedOnProxmoxNets(data) {
  if (!data.proxmox) return true
  const nets = alignProxmoxNets(data.networking.uplinks, data.proxmox.net)
  const byUplink = new Map(nets.map((n) => [n.name, n]))
  return Object.values(data.networking.vlans).every((v) => {
    if (!v.link) return true
    const net = byUplink.get(v.link)
    if (!net) return true
    return (net.vlan && net.vlan === v.id) || (net.trunks?.includes(v.id) ?? false)
  })
}

/**
 * @param {ProvisionBody} data
 * @param {z.RefinementCtx} ctx
 * @returns {void}
 */
export function refineProvision(data, ctx) {
  if (!proxmoxNetNamesMatchUplinks(data)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'each proxmox.net key must match an networking.uplinks key',
      path: ['proxmox', 'net'],
    })
  }
  if (!everyUplinkHasProxmoxNet(data)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'each networking.uplinks entry needs a matching proxmox.net.<name>',
      path: ['proxmox', 'net'],
    })
  }
  if (!vlansCarriedOnProxmoxNets(data)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'each networking.vlans id must be carried on proxmox.net.<link> (tag or trunks)',
      path: ['proxmox', 'net'],
    })
  }
}
