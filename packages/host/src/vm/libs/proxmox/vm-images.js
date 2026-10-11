import { chalk, fs, path } from 'zx'

import { IMAGE } from '../../commands/download.js'
import { getImages } from '../paths.js'
import { ensureCloudImage } from '../platform-tooling.js'
import { die, errMessage } from '../util.js'

/** @import { ProxmoxClient } from './client.js' */

/**
 * @param {string} size e.g. 2G, 1024M → integer GiB (≥1) for unused PVE disks
 * @returns {number}
 */
export function sizeToGiB(size) {
  const m = String(size)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*([KMGT])i?B?$/i)
  if (!m) die(`bad disk size ${JSON.stringify(size)} (want e.g. 2G)`)
  const n = Number(m[1])
  const u = (m[2] ?? '').toUpperCase()
  const gib =
    u === 'T' ? n * 1024 : u === 'G' ? n : u === 'M' ? n / 1024 : u === 'K' ? n / 1024 / 1024 : n
  const out = Math.max(1, Math.ceil(gib))
  return out
}

/**
 * Ensure directory storage allows `import` (for cloud qcow2 download-url).
 * @param {ProxmoxClient} client
 * @param {string} storage
 * @returns {Promise<void>}
 */
export async function ensureImportContent(client, storage) {
  const cur = await client.get(`/storage/${encodeURIComponent(storage)}`)
  const parts = String(cur.content || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.includes('import')) {
    console.log(chalk.dim(`vm: storage ${storage} already has import content`))
    return
  }
  const content = [...new Set([...parts, 'import'])].join(',')
  console.log(chalk.cyan(`vm: enabling import content on storage ${storage}…`))
  await client.put(`/storage/${encodeURIComponent(storage)}`, {
    content,
    digest: cur.digest,
  })
}

/**
 * Ensure Rocky cloud qcow2 exists as local:import/….
 * Prefers LAN upload of the workstation cache; falls back to PVE download-url
 * (public Rocky mirror — much slower than a local copy).
 * @param {ProxmoxClient} client
 * @param {{ imageStorage?: string, force?: boolean }} [opts]
 * @returns {Promise<string>} volid
 */
export async function ensureCloudImageImport(client, { imageStorage, force = false } = {}) {
  await ensureCloudImage({ target: 'proxmox' })
  const storage = imageStorage || client.config.imageStorage || 'local'
  await ensureImportContent(client, storage)
  const volid = `${storage}:import/${IMAGE.file}`
  const node = client.config.node
  const list =
    (await client.get(
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`,
      { content: 'import' },
    )) || []
  const hit = list.find(
    (/** @type {{ volid?: string }} */ e) =>
      e.volid === volid || String(e.volid).endsWith(`/${IMAGE.file}`),
  )
  if (hit && !force) {
    console.log(chalk.green(`vm: Proxmox image OK ${hit.volid}`))
    return hit.volid
  }
  if (hit && force) {
    console.log(chalk.yellow(`vm: removing ${hit.volid} (--force-download)`))
    await client.deleteVolume(hit.volid)
  }

  const localPath = path.join(getImages(), IMAGE.file)
  if (fs.existsSync(localPath)) {
    console.log(chalk.cyan(`vm: LAN upload cached image ${localPath}`))
    return client.upload(storage, 'import', localPath, {
      filename: IMAGE.file,
      timeoutSec: 3600,
    })
  }

  console.log(
    chalk.cyan(
      `vm: no local cache at ${localPath} — PVE download-url from Rocky mirror (internet)`,
    ),
  )
  const upid = await client.post(
    `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/download-url`,
    {
      content: 'import',
      filename: IMAGE.file,
      url: IMAGE.url,
      checksum: IMAGE.sha256,
      'checksum-algorithm': 'sha256',
    },
  )
  await client.waitTask(String(upid), { timeoutSec: 3600 })
  console.log(chalk.green(`vm: Proxmox imported ${volid}`))
  return volid
}

/**
 * Upload a NoCloud ISO to image storage.
 * @param {ProxmoxClient} client
 * @param {string} isoPath
 * @param {{ imageStorage?: string, filename?: string }} [opts]
 * @returns {Promise<string>} volid
 */
export async function uploadSeedIso(client, isoPath, { imageStorage, filename } = {}) {
  const storage = imageStorage || client.config.imageStorage || 'local'
  if (!fs.existsSync(isoPath)) die(`seed ISO missing: ${isoPath}`)
  const name = filename || path.basename(isoPath)
  const volid = `${storage}:iso/${name}`
  const node = client.config.node
  const list =
    (await client.get(
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`,
      { content: 'iso' },
    )) || []
  const hit = list.find(
    (/** @type {{ volid?: string }} */ e) =>
      e.volid === volid || String(e.volid).endsWith(`/${name}`),
  )
  if (hit) {
    console.log(chalk.yellow(`vm: replacing ISO ${hit.volid}`))
    await client.deleteVolume(hit.volid)
  }
  console.log(chalk.cyan(`vm: uploading seed ISO → ${volid}`))
  return client.upload(storage, 'iso', isoPath, { filename: name, timeoutSec: 600 })
}

/**
 * Detach NoCloud CDROM(s) from a running/stopped VM and delete the ISO volume.
 * Call only after cloud-init Final Stage (or guest poweroff for init-tank).
 * @param {ProxmoxClient} client
 * @param {number} vmid
 * @param {string | null | undefined} isoVolid
 * @returns {Promise<void>}
 */
export async function detachAndDeleteSeedIso(client, vmid, isoVolid) {
  const node = client.config.node
  try {
    const cfg = await client.qemuConfig(vmid)
    const cdKeys = Object.keys(cfg || {}).filter(
      (k) => /^ide\d+$/.test(k) && /media=cdrom/.test(String(cfg[k])),
    )
    if (cdKeys.length) {
      console.log(chalk.cyan(`vm: detaching seed CDROM (${cdKeys.join(',')})`))
      await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
        delete: cdKeys.join(','),
      })
    }
  } catch (err) {
    console.warn(chalk.yellow(`vm: detach seed CDROM failed: ${errMessage(err)}`))
  }
  if (!isoVolid) return
  try {
    console.log(chalk.cyan(`vm: deleting seed ISO ${isoVolid}`))
    await client.deleteVolume(isoVolid)
    console.log(chalk.green(`vm: seed ISO removed`))
  } catch (err) {
    console.warn(chalk.yellow(`vm: delete seed ISO failed: ${errMessage(err)}`))
  }
}

/**
 * After first-boot / serial follow: switch display off serial0 so PVE noVNC/Console works.
 * Keeps serial0=socket for termproxy. Applies via guest reboot when the VM is running.
 * @param {ProxmoxClient} client
 * @param {number} vmid
 * @param {{ reboot?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function restoreProxmoxDisplay(client, vmid, { reboot = true } = {}) {
  const node = client.config.node
  const cfg = await client.qemuConfig(vmid)
  const vga = String(cfg.vga || '')
  if (vga && vga !== 'serial0' && !/^serial/i.test(vga)) {
    console.log(chalk.dim(`vm: display already ${vga} (serial0 kept for termproxy)`))
    return
  }

  console.log(
    chalk.cyan(`vm: restoring display to virtio (PVE Console/noVNC; serial0 kept for termproxy)`),
  )
  await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
    vga: 'virtio',
    serial0: 'socket',
  })

  if (!reboot) return
  const st = await client.qemuStatus(vmid)
  if (st?.status !== 'running' && st?.status !== 'paused') {
    console.log(chalk.dim('vm: display change pending until next start'))
    return
  }
  console.log(chalk.cyan('vm: rebooting guest so virtio display applies…'))
  try {
    const upid = await client.post(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/reboot`,
      {},
    )
    if (upid) await client.waitTask(String(upid), { timeoutSec: 120 })
    console.log(chalk.green('vm: reboot requested (PVE Console should work after boot)'))
  } catch (err) {
    console.warn(
      chalk.yellow(
        `vm: reboot after display restore failed: ${errMessage(err)} — start/reboot in PVE UI`,
      ),
    )
  }
}
