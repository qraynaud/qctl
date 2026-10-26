/**
 * Apply desired NICs to a Proxmox QEMU guest (create/reconcile).
 * Plan comes from the host ({@link VmNicsSpec} / {@link AlignedVmNic}[]);
 * this module only maps label order → net0..netN and removes extras.
 * Proxmox only attaches `mode: bridge` NICs (`nat` / omit `vm` skipped).
 */
import { chalk } from 'zx'

import { VM_ATTACH_MODE } from '../../../provision/schema/networking.js'
import { pveUnknown, pveUpid } from './api-schemas.js'
import { applyNetsToForm, mergeNetPreserveMac, nicsSpecToAligned } from './net.js'

/** @import { VmNicsSpec } from '../../driver-contract.js' */
/** @import { ProxmoxClient } from './client.js' */
/** @import { AlignedVmNic, QemuConfig } from './types.js' */

/**
 * Keep only bridge attach rows (PVE has no userspace/NAT NIC).
 * @param {AlignedVmNic[] | null | undefined} nets
 * @returns {AlignedVmNic[]}
 */
function bridgedAlignedOnly(nets) {
  return (nets || []).filter((n) => n.vm?.mode === VM_ATTACH_MODE.BRIDGE)
}

/**
 * @param {ProxmoxClient} client
 * @param {AlignedVmNic[] | VmNicsSpec | null | undefined} nics
 * @returns {AlignedVmNic[]}
 */
export function resolveAlignedNics(client, nics) {
  if (Array.isArray(nics)) return bridgedAlignedOnly(nics)
  if (nics && !Array.isArray(nics)) return nicsSpecToAligned(nics)
  return bridgedAlignedOnly(client.config.nets)
}

/**
 * Write net0..netN onto `form`, preserving MACs from `cfg` when desired omits them.
 * @param {QemuConfig} form
 * @param {QemuConfig | null | undefined} cfg
 * @param {AlignedVmNic[]} nets
 * @returns {number} net count
 */
export function putNetsOnForm(form, cfg, nets) {
  const netCount = applyNetsToForm(form, nets)
  for (let i = 0; i < netCount; i++) {
    const key = `net${i}`
    form[key] = mergeNetPreserveMac(cfg?.[key], String(form[key]))
  }
  return netCount
}

/**
 * Extra `netN` keys to delete when shrinking the NIC list.
 * @param {QemuConfig | null | undefined} cfg
 * @param {number} netCount
 * @returns {string[]}
 */
export function surplusNetKeys(cfg, netCount) {
  /** @type {string[]} */
  const out = []
  for (const key of Object.keys(cfg || {})) {
    const m = /^net(\d+)$/.exec(key)
    if (m && Number(m[1]) >= netCount) out.push(key)
  }
  return out
}

/**
 * Reconcile hypervisor NICs only (remove extras, update/create net0..netN).
 * Leaves disks and other hardware alone. Stops the VM if running.
 *
 * @param {ProxmoxClient} client
 * @param {{
 *   vmid: number,
 *   name: string,
 *   nics: AlignedVmNic[] | VmNicsSpec,
 * }} opts
 * @returns {Promise<{ vmid: number, netCount: number }>}
 */
export async function reconcileRockyNics(client, opts) {
  const { vmid, name } = opts
  const nets = resolveAlignedNics(client, opts.nics)
  const node = client.config.node

  const st = await client.qemuStatus(vmid)
  if (st?.status === 'running' || st?.status === 'paused') {
    console.log(chalk.cyan(`vm: stopping ${name} for NIC reconcile…`))
    const upid = await client.post(
      pveUpid,
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`,
      {},
    )
    if (upid) await client.waitTask(String(upid), { timeoutSec: 120 })
  }

  const cfg = await client.qemuConfig(vmid)
  /** @type {QemuConfig} */
  const form = {}
  const netCount = putNetsOnForm(form, cfg, nets)
  const deleteKeys = surplusNetKeys(cfg, netCount)
  if (deleteKeys.length) form.delete = deleteKeys.join(',')

  await client.put(pveUnknown, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, form)
  console.log(
    chalk.dim(
      `vm: ${name} nics=${
        nets.length
          ? nets
              .map((n) => {
                const br = n.vm?.mode === VM_ATTACH_MODE.BRIDGE ? n.vm.bridge : '?'
                return `${n.label}→net/${br}`
              })
              .join(', ')
          : '(none)'
      }`,
    ),
  )
  return { vmid, netCount }
}
