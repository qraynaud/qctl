import { chalk } from 'zx'

import { DATA_COUNT, SPECIAL_COUNT } from '../../../lib/paths.js'
import { die } from '../../../lib/util.js'
import { applyNetsToForm } from './config.js'
import {
  assertNameFreeForCreate,
  demoteToHolder,
  destroyHolder,
  emptyDiskState,
} from './disk-holder.js'
import { sizeToGiB } from './vm-images.js'
import { diskSerialFromValue, volidFromDiskValue } from './vm-parse.js'

/** @import { ProxmoxClient } from './client.js' */
/** @import { CreateRockyVmOpts, DestroyRockyVmOpts, QemuConfig } from './types.js' */

/**
 * Create a rocky-shaped VM (OS import + /vw + tank disks + NoCloud CDROM) and start it.
 *
 * @param {ProxmoxClient} client
 * @param {CreateRockyVmOpts} opts
 * @returns {Promise<{ vmid: number }>}
 */
export async function createAndStartRockyVm(client, opts) {
  const {
    name,
    memory,
    vcpus,
    vwSize,
    dataSize,
    specialSize,
    importVolid,
    isoVolid,
    vwVolid = null,
    dataVolids = null,
    specialVolids = null,
    vmid: fixedVmid = null,
  } = opts
  const { node, storage, vmid: cfgVmid } = client.config
  // Belt-and-suspenders: callers should check too; Proxmox allows duplicate names.
  await assertNameFreeForCreate(client, name)
  const vmid = Number(fixedVmid || cfgVmid || (await client.nextId()))
  if (!Number.isInteger(vmid) || vmid < 100) die(`bad vmid ${vmid}`)
  const taken = await client.findVmidByName(name) // re-check after nextId race window
  if (taken != null) {
    die(`Proxmox VM ${name} appeared during create (vmid=${taken}) — refuse duplicate`)
  }
  const idClash = ((await client.qemuList()) || []).find((vm) => Number(vm.vmid) === vmid)
  if (idClash) {
    die(`vmid ${vmid} already in use (${idClash.name || '?'}) — retry or set proxmox_vmid`)
  }

  const vwGiB = sizeToGiB(vwSize)
  const dataGiB = sizeToGiB(dataSize)
  const specialGiB = sizeToGiB(specialSize)

  /** @type {QemuConfig} */
  const form = {
    vmid: String(vmid),
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
    scsi0: `${storage}:0,import-from=${importVolid},size=20G`,
    ide2: `${isoVolid},media=cdrom`,
  }
  applyNetsToForm(form, client.config.nets)

  if (vwVolid) form.scsi1 = `${vwVolid},serial=rocky-vw`
  else form.scsi1 = `${storage}:${vwGiB},serial=rocky-vw`

  let scsi = 2
  for (let i = 0; i < DATA_COUNT; i++) {
    const reuse = dataVolids?.[i]
    form[`scsi${scsi++}`] = reuse
      ? `${reuse},serial=rocky-data${i}`
      : `${storage}:${dataGiB},serial=rocky-data${i}`
  }
  for (let i = 0; i < SPECIAL_COUNT; i++) {
    const reuse = specialVolids?.[i]
    form[`scsi${scsi++}`] = reuse
      ? `${reuse},serial=rocky-special${i}`
      : `${storage}:${specialGiB},serial=rocky-special${i}`
  }

  console.log(
    chalk.cyan(
      `vm: creating Proxmox VM ${name} vmid=${vmid} `
        + `(OS + /vw + data×${DATA_COUNT} + special×${SPECIAL_COUNT} + NoCloud ISO)`,
    ),
  )
  const createUpid = await client.post(`/nodes/${encodeURIComponent(node)}/qemu`, form)
  if (createUpid) await client.waitTask(String(createUpid), { timeoutSec: 1800 })

  console.log(chalk.cyan(`vm: starting ${name}…`))
  const startUpid = await client.post(
    `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`,
    {},
  )
  if (startUpid) await client.waitTask(String(startUpid), { timeoutSec: 120 })
  console.log(chalk.green(`vm: Proxmox VM ${name} (vmid=${vmid}) running`))
  return { vmid }
}

/**
 * Stop + delete VM (or demote to holder).
 * keep=persistent|vw → demote to `<name>-disks` (disks stay attached; rename).
 * keep=none → wipe VM volumes + destroy holder.
 *
 * @param {ProxmoxClient} client
 * @param {DestroyRockyVmOpts} opts
 */
export async function destroyRockyVm(client, { vmid, name, keep = 'none' }) {
  const node = client.config.node
  const st = await client.qemuStatus(vmid)
  if (st?.status === 'running' || st?.status === 'paused') {
    console.log(chalk.cyan(`vm: stopping ${name || vmid}…`))
    const upid = await client.post(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`,
      {},
    )
    if (upid) await client.waitTask(String(upid), { timeoutSec: 120 })
  }

  const cfg = await client.qemuConfig(vmid)

  if (keep === 'vw' || keep === 'persistent') {
    if (!name) die('destroy keep=vw|persistent requires name (holder)')

    if (keep === 'vw') {
      const tankKeys = []
      for (const [key, val] of Object.entries(cfg)) {
        if (!/^(scsi|virtio|sata)\d+$/.test(key)) continue
        const serial = diskSerialFromValue(val)
        if (serial && /^rocky-(data|special)/.test(serial)) {
          console.log(chalk.yellow(`vm: wipe tank disk ${volidFromDiskValue(val)} (${serial})`))
          tankKeys.push(key)
        }
      }
      if (tankKeys.length) {
        await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
          delete: tankKeys.join(','),
          force: '1',
        })
      }
    }

    const parked = await demoteToHolder(client, { vmid, name })
    console.log(
      chalk.green(
        keep === 'persistent'
          ? `vm: kept /vw + data×${DATA_COUNT} + special×${SPECIAL_COUNT} on holder ${name}-disks`
          : `vm: kept /vw on holder ${name}-disks (tank removed)`,
      ),
    )
    return parked
  }

  // keep === none: destroy all disks on this VM, delete VM, wipe holder
  const toDestroy = []
  for (const [key, val] of Object.entries(cfg)) {
    if (!/^(scsi|virtio|sata|ide)\d+$/.test(key) && !/^unused\d+$/.test(key)) continue
    if (/media=cdrom/.test(String(val))) {
      toDestroy.push(key)
      continue
    }
    const volid = volidFromDiskValue(val)
    if (volid) console.log(chalk.yellow(`vm: remove disk ${volid}`))
    toDestroy.push(key)
  }
  if (toDestroy.length) {
    await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
      delete: toDestroy.join(','),
      force: '1',
    })
  }

  const delUpid = await client.del(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}`, {
    purge: '1',
    'destroy-unreferenced-disks': '1',
  })
  if (delUpid) await client.waitTask(String(delUpid), { timeoutSec: 300 })

  try {
    const list =
      (await client.get(
        `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(client.config.storage)}/content`,
        { content: 'images' },
      )) || []
    for (const e of list) {
      if (String(e.volid).includes(`vm-${vmid}-`)) {
        console.log(chalk.yellow(`vm: remove leftover ${e.volid}`))
        await client.deleteVolume(e.volid)
      }
    }
  } catch {
    /* ignore */
  }

  if (name) await destroyHolder(client, name)

  console.log(chalk.green(`vm: Proxmox VM ${name || vmid} destroyed`))
  return emptyDiskState(vmid)
}

/**
 * @param {ProxmoxClient} client
 * @param {number} vmid
 * @param {{ timeoutSec?: number, name?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<void>}
 */
export async function waitUntilVmStopped(client, vmid, { timeoutSec, name, signal } = {}) {
  const { sleep, isAbortError } = await import('../wait.js')
  const deadline = Date.now() + (timeoutSec || 2700) * 1000
  console.log(
    chalk.cyan(
      `vm: waiting for guest poweroff (vmid=${vmid}${name ? ` ${name}` : ''}, timeout ${timeoutSec}s)…`,
    ),
  )
  let attempt = 0
  for (;;) {
    if (signal?.aborted) {
      throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
    }
    const st = await client.qemuStatus(vmid)
    const status = st?.status || '?'
    if (status === 'stopped') {
      console.log(chalk.green('vm: guest stopped (init-tank finished)'))
      return
    }
    if (Date.now() >= deadline) {
      die(
        `VM ${name || vmid} still ${status} after ${timeoutSec}s — init-tank likely failed; check PVE console`,
      )
    }
    attempt += 1
    if (attempt === 1 || attempt % 6 === 0) {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000))
      console.log(chalk.dim(`vm: status=${status} (${left}s left)`))
    }
    try {
      await sleep(5000, signal)
    } catch (err) {
      if (isAbortError(err)) throw err
      throw err
    }
  }
}
