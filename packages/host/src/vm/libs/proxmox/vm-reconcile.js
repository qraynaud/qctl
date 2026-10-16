import { chalk } from 'zx'

import { assertProxmoxAttachModes, withAttachModes } from '../attach-mode.js'
import { applyNetsToForm, mergeNetPreserveMac } from './config.js'
import { diskStateFromConfig } from './disk-holder.js'
import { rockyTpmstate } from './tpm.js'
import { sizeToGiB } from './vm-images.js'
import { diskSerialFromValue } from './vm-parse.js'

/** @import { ProxmoxClient } from './client.js' */
/** @import { AttachDiskSpec, QemuConfig } from './types.js' */

/** @typedef {QemuConfig[string]} QemuValue */

/**
 * @param {QemuValue} existingNet0
 * @param {string} desiredNet0
 * @returns {string}
 */
function net0WithPreservedMac(existingNet0, desiredNet0) {
  return mergeNetPreserveMac(existingNet0, desiredNet0)
}

/**
 * @param {string} key
 * @param {QemuValue} val
 * @param {Set<string>} expectedIds
 * @returns {boolean}
 */
function isManagedDiskKey(key, val, expectedIds) {
  if (!/^(scsi|virtio|sata)\d+$/.test(key)) return false
  if (/media=cdrom/.test(String(val))) return false
  if (key === 'scsi0' && !diskSerialFromValue(val)) return true
  const serial = diskSerialFromValue(val)
  return Boolean(serial && expectedIds.has(serial))
}

/**
 * @param {string} key
 * @param {QemuValue} val
 * @param {{ netCount?: number, expectedIds: Set<string> }} opts
 * @returns {boolean}
 */
function isCruftHardwareKey(key, val, { netCount = 1, expectedIds }) {
  const netM = /^net(\d+)$/.exec(key)
  if (netM) return Number(netM[1]) >= netCount
  if (/^ide\d+$/.test(key)) return true
  if (/^unused\d+$/.test(key)) return true
  // tpmstate0 is part of the rocky appliance profile (always-on vTPM 2.0)
  if (/^(audio|usb|parallel|efidisk|hostpci|rng|balloon)\d*$/.test(key)) return true
  if (/^tpmstate[1-9]\d*$/.test(key)) return true
  if (/^serial[1-9]\d*$/.test(key)) return true
  if (/^(scsi|virtio|sata)\d+$/.test(key)) {
    if (isManagedDiskKey(key, val, expectedIds)) return false
    if (key === 'scsi0') return false
    return true
  }
  return false
}

/**
 * @param {QemuConfig | null | undefined} cfg
 * @param {string[]} pendingKeys
 * @returns {Set<number>}
 */
function takenScsiIndexes(cfg, pendingKeys) {
  /** @type {Set<number>} */
  const taken = new Set()
  for (const k of Object.keys(cfg || {})) {
    const m = /^scsi(\d+)$/.exec(k)
    if (m) taken.add(Number(m[1]))
  }
  for (const k of pendingKeys) {
    const m = /^scsi(\d+)$/.exec(k)
    if (m) taken.add(Number(m[1]))
  }
  return taken
}

/**
 * @param {Set<number>} taken
 * @param {number | null | undefined} prefer
 * @returns {number}
 */
function allocScsi(taken, prefer) {
  if (prefer != null && !taken.has(prefer)) {
    taken.add(prefer)
    return prefer
  }
  let i = 0
  while (taken.has(i)) i += 1
  taken.add(i)
  return i
}

/**
 * Align an existing appliance VM to the rocky hardware profile:
 * machine q35, serial console, net0 from provision, topology disks present;
 * remove leftover NICs/CDROMs/UI cruft. Does not recreate the OS disk.
 * Leaves the VM stopped.
 * @param {ProxmoxClient} client
 * @param {{
 *   vmid: number,
 *   name: string,
 *   memory: number,
 *   vcpus: number,
 *   disks: AttachDiskSpec[],
 * }} opts
 * @returns {Promise<{ vmid: number }>}
 */
export async function reconcileRockyAppliance(client, opts) {
  const { vmid, name, memory, vcpus, disks } = opts
  const node = client.config.node
  const storage = client.config.storage
  const expectedIds = new Set(disks.map((d) => d.id))

  const classified = withAttachModes(
    disks.map((d) => ({
      id: d.id,
      kind: d.kind,
      ...(d.size ? { size: d.size } : {}),
    })),
  )

  const st = await client.qemuStatus(vmid)
  if (st?.status === 'running' || st?.status === 'paused') {
    console.log(chalk.cyan(`vm: stopping ${name} for hardware reconcile…`))
    const upid = await client.post(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`,
      {},
    )
    if (upid) await client.waitTask(String(upid), { timeoutSec: 120 })
  }

  const cfg = await client.qemuConfig(vmid)
  const state = diskStateFromConfig(cfg, vmid)
  assertProxmoxAttachModes(classified, state.volids)

  const nets = client.config.nets?.length
    ? client.config.nets
    : [
        {
          bridge: client.config.bridge || 'vmbr0',
          vlan: client.config.vlan,
          trunks: client.config.trunks,
          mac: client.config.mac,
        },
      ]
  const netCount = nets.length
  /** @type {string[]} */
  const deleteKeys = []
  for (const [key, val] of Object.entries(cfg)) {
    if (isCruftHardwareKey(key, val, { netCount, expectedIds })) deleteKeys.push(key)
  }

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
  }
  applyNetsToForm(form, nets)
  for (let i = 0; i < netCount; i++) {
    const key = `net${i}`
    form[key] = net0WithPreservedMac(cfg[key], String(form[key]))
  }

  const taken = takenScsiIndexes(cfg, deleteKeys)
  for (const k of deleteKeys) {
    const m = /^scsi(\d+)$/.exec(k)
    if (m) taken.delete(Number(m[1]))
  }

  /** @type {string[]} */
  const added = []
  let prefer = 1
  for (const d of disks) {
    if (state.volids[d.id]) {
      prefer += 1
      continue
    }
    if (d.mode === 'physical' || !d.size) {
      // assertProxmoxAttachModes already failed if missing
      prefer += 1
      continue
    }
    const slot = allocScsi(taken, prefer++)
    form[`scsi${slot}`] = `${storage}:${sizeToGiB(d.size)},serial=${d.id}`
    added.push(`scsi${slot}=${d.id}`)
  }

  if (!cfg.scsi0 || /media=cdrom/.test(String(cfg.scsi0))) {
    console.warn(
      chalk.yellow(
        `vm: reconcile: no OS disk on scsi0 — not creating one (use up --wipe-os or create)`,
      ),
    )
  }

  if (!cfg.tpmstate0) {
    form.tpmstate0 = rockyTpmstate(storage)
    added.push('tpmstate0')
  }

  if (deleteKeys.length || added.length) {
    console.log(
      chalk.cyan(
        `vm: reconcile ${name}: `
          + [
            deleteKeys.length ? `delete ${deleteKeys.join(',')}` : null,
            added.length ? `add ${added.join(',')}` : null,
            `set machine=q35 net0 memory=${memory} cores=${vcpus}`,
          ]
            .filter(Boolean)
            .join('; '),
      ),
    )
  } else {
    console.log(chalk.dim(`vm: reconcile ${name}: baseline q35/net/serial/agent/tpm`))
  }

  if (deleteKeys.length) {
    await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
      delete: deleteKeys.join(','),
      force: '1',
    })
  }
  await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, form)
  console.log(chalk.green(`vm: reconcile ${name} done (stopped)`))
  return { vmid }
}
