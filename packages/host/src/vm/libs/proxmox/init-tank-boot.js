/**
 * Proxmox init-tank: attach / remove disposable boot on an existing appliance VM.
 * Leaves scsi0 (disks.os) alone.
 */
import { chalk } from 'zx'

import { die } from '../../../lib/util.js'
import { INIT_TANK_BOOT_ID } from '../init-tank-boot.js'
import { pveUnknown, pveUpid } from './api-schemas.js'
import { applyNetsToForm } from './config.js'
import { resolveAlignedNics } from './nic-reconcile.js'
import { sizeToGiB } from './vm-images.js'
import { diskSerialFromValue } from './vm-parse.js'

/** @import { ProxmoxClient } from './client.js' */
/** @import { AlignedVmNic, AttachDiskSpec, QemuConfig } from './types.js' */

/**
 * @param {QemuConfig} cfg
 * @returns {number}
 */
export function nextScsiSlot(cfg) {
  let scsi = 0
  for (const key of Object.keys(cfg)) {
    const m = /^scsi(\d+)$/.exec(key)
    if (m) scsi = Math.max(scsi, Number(m[1]) + 1)
  }
  return scsi
}

/**
 * @param {ProxmoxClient} client
 * @param {number} vmid
 * @param {string} reason
 */
export async function stopVmIfRunning(client, vmid, reason) {
  const node = client.config.node
  const st = await client.qemuStatus(vmid)
  if (st?.status === 'running' || st?.status === 'paused') {
    console.log(chalk.cyan(`vm: stopping vmid=${vmid} to ${reason}…`))
    const upid = await client.post(
      pveUpid,
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`,
      {},
    )
    if (upid) await client.waitTask(String(upid), { timeoutSec: 120 })
  }
}

/**
 * Drop leftover init-tank disposable boot disks.
 * @param {ProxmoxClient} client
 * @param {number} vmid
 * @param {string} [preferKey]
 */
export async function removeInitTankBootDisks(client, vmid, preferKey) {
  const node = client.config.node
  const cfg = await client.qemuConfig(vmid)
  /** @type {string[]} */
  const drop = []
  if (preferKey && cfg[preferKey]) drop.push(preferKey)
  for (const [key, val] of Object.entries(cfg)) {
    if (!/^(scsi|virtio|sata)\d+$/.test(key)) continue
    if (preferKey && key === preferKey) continue
    const serial = diskSerialFromValue(val)
    if (serial === INIT_TANK_BOOT_ID) drop.push(key)
  }
  if (!drop.length) return
  console.log(chalk.yellow(`vm: remove init-tank boot ${drop.join(',')}`))
  await client.put(pveUnknown, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
    delete: [...new Set(drop)].join(','),
    force: '1',
  })
}

/**
 * Existing appliance: attach disposable boot first, leave disks.os (scsi0) alone.
 * @param {ProxmoxClient} client
 * @param {{
 *   vmid: number,
 *   name: string,
 *   memory: number|string,
 *   vcpus: number|string,
 *   importVolid: string,
 *   isoVolid: string,
 *   osSize: string,
 *   forceTankIds: string[],
 *   diskSpecs: AttachDiskSpec[],
 *   nics?: AlignedVmNic[],
 * }} opts
 * @returns {Promise<{ bootKey: string }>}
 */
export async function attachInitTankBootOnAppliance(client, opts) {
  const {
    vmid,
    name,
    memory,
    vcpus,
    importVolid,
    isoVolid,
    osSize,
    forceTankIds,
    diskSpecs,
    nics,
  } = opts
  const node = client.config.node
  const storage = client.config.storage

  await stopVmIfRunning(client, vmid, 'attach init-tank boot disk')
  let cfg = await client.qemuConfig(vmid)

  if (forceTankIds.length) {
    /** @type {string[]} */
    const tankKeys = []
    const wipe = new Set(forceTankIds)
    for (const [key, val] of Object.entries(cfg)) {
      if (!/^(scsi|virtio|sata)\d+$/.test(key)) continue
      const serial = diskSerialFromValue(val)
      if (serial && wipe.has(serial)) tankKeys.push(key)
    }
    if (tankKeys.length) {
      await client.put(pveUnknown, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
        delete: tankKeys.join(','),
        force: '1',
      })
      cfg = await client.qemuConfig(vmid)
    }
  }

  await removeInitTankBootDisks(client, vmid)
  cfg = await client.qemuConfig(vmid)

  const bootSlot = nextScsiSlot(cfg)
  const bootKey = `scsi${bootSlot}`
  console.log(
    chalk.cyan(
      `vm: appliance ${name}: disposable boot ${bootKey} (keep scsi0); boot order=${bootKey}`,
    ),
  )

  /** @type {QemuConfig} */
  const form = {
    name,
    memory: String(memory),
    cores: String(vcpus),
    cpu: 'host',
    ostype: 'l26',
    machine: 'q35',
    scsihw: 'virtio-scsi-single',
    agent: '1',
    serial0: 'socket',
    vga: 'serial0',
    boot: `order=${bootKey}`,
    [bootKey]: `${storage}:0,import-from=${importVolid},size=${osSize},serial=${INIT_TANK_BOOT_ID}`,
    ide2: `${isoVolid},media=cdrom`,
  }
  applyNetsToForm(form, resolveAlignedNics(client, nics))

  let scsi = nextScsiSlot({ ...cfg, [bootKey]: '1' })
  const recreate = new Set(forceTankIds)
  for (const d of diskSpecs) {
    if (d.kind !== 'tank' || !recreate.has(d.id)) continue
    if (!d.size) die(`init-tank: tank member ${d.id} needs size to recreate`)
    const still = Object.values(cfg).some((v) => diskSerialFromValue(v) === d.id)
    if (still) continue
    form[`scsi${scsi++}`] = `${storage}:${sizeToGiB(d.size)},serial=${d.id}`
  }

  await client.put(pveUnknown, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, form)
  return { bootKey }
}
