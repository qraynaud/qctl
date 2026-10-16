/**
 * Portable Proxmox disk inventory via a stopped holder VM.
 * Name: <vm>-disks (e.g. rocky-dev-disks).
 *
 * Disks stay attached (with serials) — we rename/promote the holder into the
 * appliance instead of detach→create (unused/delete frees LVs).
 * Holder layout: scsi0 free for OS; scsi1+= persistent members (serial = disk id).
 */
import { chalk } from 'zx'

import { die } from '../../../lib/util.js'
import { INIT_TANK_BOOT_ID } from '../init-tank-boot.js'
import { applyNetsToForm } from './config.js'
import { rockyTpmstate } from './tpm.js'
import { diskSerialFromValue, volidFromDiskValue } from './vm-parse.js'

/**
 * @param {string} name
 * @returns {string}
 */
export function holderVmName(name) {
  return `${name}-disks`
}

/** @import { ProxmoxClient } from './client.js' */
/** @import { CreateRockyVmOpts, DiskState, QemuConfig } from './types.js' */

/**
 * Refuse create when appliance name or holder already exists (Proxmox allows
 * duplicate names; creating then leaves two rocky* VMs).
 * @param {ProxmoxClient} client
 * @param {string} name
 * @param {{ allowHolder?: boolean }} [opts] if allowHolder, only check appliance name
 *   (unused today; promote path renames the holder instead of create).
 */
export async function assertNameFreeForCreate(client, name, { allowHolder = false } = {}) {
  const existing = await client.findVmidByName(name)
  if (existing != null) {
    die(
      `Proxmox VM ${name} already exists (vmid=${existing}) — refuse create `
        + `(start it with up, or use --wipe-os / destroy)`,
    )
  }
  if (allowHolder) return
  const hname = holderVmName(name)
  const hvmid = await client.findVmidByName(hname)
  if (hvmid != null) {
    die(
      `holder ${hname} already exists (vmid=${hvmid}) — refuse create `
        + `(would leave two VMs). Promote needs persistent disk serials on the holder; `
        + `fix disks or: qctl vm destroy --target proxmox`,
    )
  }
}

/**
 * @param {number} [vmid]
 * @returns {DiskState}
 */
export function emptyDiskState(vmid) {
  return { volids: {}, vmid }
}

/**
 * Parse serial → volid map from a qemu config object.
 * @param {QemuConfig | null | undefined} cfg
 * @param {number} [vmid]
 * @returns {DiskState}
 */
export function diskStateFromConfig(cfg, vmid) {
  const state = emptyDiskState(vmid)
  for (const [key, val] of Object.entries(cfg || {})) {
    if (!/^(scsi|virtio|sata)\d+$/.test(key)) continue
    if (/media=cdrom/.test(String(val))) continue
    const serial = diskSerialFromValue(val)
    const volid = volidFromDiskValue(val)
    if (!serial || !volid) continue
    state.volids[serial] = volid
  }
  return state
}

/**
 * @param {DiskState | null | undefined} state
 * @param {string[]} expectedIds non-OS disk ids that must be present
 * @param {string} name
 * @returns {void}
 */
export function assertPersistentDisks(state, expectedIds, name) {
  if (!expectedIds.length) {
    die(`no persistent disks expected for ${name}`)
  }
  for (const id of expectedIds) {
    if (!state?.volids?.[id]) {
      die(
        `missing disk serial=${id} for ${name} — run init-tank, or check holder VM `
          + `${holderVmName(name)} on Proxmox`,
      )
    }
  }
}

/**
 * @param {ProxmoxClient} client
 * @param {string} name
 * @returns {Promise<DiskState | null>}
 */
export async function loadDisksFromHolder(client, name) {
  const hname = holderVmName(name)
  const vmid = await client.findVmidByName(hname)
  if (vmid == null) return null
  const cfg = await client.qemuConfig(vmid)
  const state = diskStateFromConfig(cfg, vmid)
  console.log(chalk.dim(`vm: disks on holder ${hname} (vmid=${vmid})`))
  return state
}

/**
 * @param {ProxmoxClient} client
 * @param {number} vmid
 * @param {string} [label]
 * @returns {Promise<void>}
 */
async function stopVm(client, vmid, label) {
  const node = client.config.node
  const st = await client.qemuStatus(vmid)
  if (st?.status === 'running' || st?.status === 'paused') {
    console.log(chalk.cyan(`vm: stopping ${label || vmid}…`))
    const upid = await client.post(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`,
      {},
    )
    if (upid) await client.waitTask(String(upid), { timeoutSec: 120 })
  }
}

/**
 * Turn appliance VM into stopped holder: drop OS/CDROM/net noise, rename to <name>-disks.
 * Disks with a serial stay attached (scsi1+).
 * @param {ProxmoxClient} client
 * @param {{ vmid: number, name: string }} opts
 * @returns {Promise<DiskState>}
 */
export async function demoteToHolder(client, { vmid, name }) {
  const node = client.config.node
  const hname = holderVmName(name)
  await stopVm(client, vmid, name)

  const existingHolder = await client.findVmidByName(hname)
  if (existingHolder != null && existingHolder !== vmid) {
    die(`holder ${hname} already exists (vmid=${existingHolder}) — destroy it first`)
  }

  const cfg = await client.qemuConfig(vmid)
  /** @type {string[]} */
  const drop = []
  for (const [key, val] of Object.entries(cfg)) {
    if (/^ide\d+$/.test(key) && /media=cdrom/.test(String(val))) {
      drop.push(key)
      continue
    }
    if (!/^(scsi|virtio|sata)\d+$/.test(key)) continue
    const serial = diskSerialFromValue(val)
    // Disposable init-tank boot (if marked) always drops with demote.
    if (serial === INIT_TANK_BOOT_ID) {
      drop.push(key)
      continue
    }
    // Keep any disk that carries a serial (persistent inventory).
    if (serial) continue
    drop.push(key)
  }
  for (const key of Object.keys(cfg)) {
    if (/^net\d+$/.test(key)) drop.push(key)
  }

  if (drop.length) {
    console.log(chalk.cyan(`vm: demote ${name} → holder ${hname} (drop ${drop.join(',')})`))
    await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
      delete: drop.join(','),
      force: '1',
    })
  }

  await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
    name: hname,
    memory: '512',
    cores: '1',
  })

  const state = diskStateFromConfig(await client.qemuConfig(vmid), vmid)
  const n = Object.keys(state.volids).length
  console.log(chalk.green(`vm: holder ${hname} ready (vmid=${vmid}; ${n} persistent disk(s))`))
  return state
}

/**
 * Promote holder <name>-disks → appliance <name>: rename, add OS import + NoCloud ISO, start.
 * @param {ProxmoxClient} client
 * @param {Pick<CreateRockyVmOpts, 'name' | 'memory' | 'vcpus' | 'importVolid' | 'isoVolid' | 'osSize' | 'expectedIds'>} opts
 * @returns {Promise<{ vmid: number, state: DiskState }>}
 */
export async function promoteHolderToAppliance(client, opts) {
  const { name, memory, vcpus, importVolid, isoVolid, osSize = '20G', expectedIds = [] } = opts
  const node = client.config.node
  const storage = client.config.storage
  const hname = holderVmName(name)
  const vmid = await client.findVmidByName(hname)
  if (vmid == null) die(`holder ${hname} not found — run init-tank first`)

  const state = diskStateFromConfig(await client.qemuConfig(vmid), vmid)
  assertPersistentDisks(state, expectedIds, name)

  const cfg = await client.qemuConfig(vmid)
  if (cfg.scsi0 && !/media=cdrom/.test(String(cfg.scsi0))) {
    const serial = diskSerialFromValue(cfg.scsi0)
    if (serial && expectedIds.includes(serial)) {
      die(
        `holder ${hname} has persistent disk on scsi0 (${serial}) — expected scsi0 free for OS; re-run init-tank`,
      )
    }
    await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
      delete: 'scsi0',
      force: '1',
    })
  }

  console.log(chalk.cyan(`vm: promote holder ${hname} → ${name} (vmid=${vmid})`))
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
    boot: 'order=scsi0',
    scsi0: `${storage}:0,import-from=${importVolid},size=${osSize}`,
    ide2: `${isoVolid},media=cdrom`,
  }
  if (!cfg.tpmstate0) form.tpmstate0 = rockyTpmstate(storage)
  applyNetsToForm(form, client.config.nets)
  await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, form)

  console.log(chalk.cyan(`vm: starting ${name}…`))
  const startUpid = await client.post(
    `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`,
    {},
  )
  if (startUpid) await client.waitTask(String(startUpid), { timeoutSec: 120 })
  console.log(chalk.green(`vm: Proxmox VM ${name} (vmid=${vmid}) running`))
  return { vmid, state }
}

/**
 * Destroy holder `<name>-disks` and all of its volumes (full wipe, no keep-persistent).
 * @param {ProxmoxClient} client
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function destroyHolder(client, name) {
  const hname = holderVmName(name)
  const hvmid = await client.findVmidByName(hname)
  if (hvmid == null) {
    console.log(chalk.dim(`vm: no holder ${hname}`))
    return
  }

  const node = client.config.node
  await stopVm(client, hvmid, hname)
  const cfg = await client.qemuConfig(hvmid)
  const state = diskStateFromConfig(cfg, hvmid)
  const volids = Object.values(state.volids)

  const keys = Object.keys(cfg).filter(
    (k) => /^(scsi|virtio|sata|ide)\d+$/.test(k) || /^unused\d+$/.test(k),
  )
  if (keys.length) {
    console.log(chalk.yellow(`vm: wiping holder ${hname} disks…`))
    await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${hvmid}/config`, {
      delete: keys.join(','),
      force: '1',
    })
  }

  const upid = await client.del(`/nodes/${encodeURIComponent(node)}/qemu/${hvmid}`, {
    purge: '1',
    'destroy-unreferenced-disks': '1',
  })
  if (upid) await client.waitTask(String(upid), { timeoutSec: 300 })

  for (const volid of volids) {
    try {
      await client.deleteVolume(volid)
    } catch {
      /* already gone */
    }
  }
  console.log(chalk.green(`vm: holder ${hname} destroyed`))
}
