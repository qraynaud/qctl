/**
 * Mount every `disks.data` volume by serial (`id`): blank → mkfs(fs), existing → mount only.
 */
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { loadDisksJson } from '../disks-json.js'
import { StageError } from '../errors.js'

/** @import { DisksJson } from '@qctl/shared' */
/** @import { StageContext } from '../context.js' */

/**
 * @param {StageContext} ctx
 * @param {string} serial
 * @returns {Promise<string>}
 */
async function findDeviceBySerial(ctx, serial) {
  const byIdDir = '/dev/disk/by-id'
  if (existsSync(byIdDir)) {
    for (const name of await readdir(byIdDir)) {
      if (!name.includes(serial)) continue
      if (/-part[0-9]+$/.test(name)) continue
      const candidate = join(byIdDir, name)
      if (!existsSync(candidate)) continue
      const real = await ctx.exec(['readlink', '-f', candidate])
      if (real.code === 0 && real.stdout.trim()) return real.stdout.trim()
    }
  }

  const lsblk = await ctx.exec(['lsblk', '-ndo', 'NAME,SERIAL,TYPE'])
  if (lsblk.code === 0) {
    for (const line of lsblk.stdout.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 3) continue
      const [name, diskSerial, type] = parts
      if (diskSerial === serial && type === 'disk' && name) {
        return `/dev/${name}`
      }
    }
  }

  throw new Error(`no disk with serial ${JSON.stringify(serial)}`)
}

/**
 * @param {StageContext} ctx
 * @param {string} fs
 * @param {string} label
 * @param {string} dev
 */
async function mkfsVolume(ctx, fs, label, dev) {
  if (fs === 'xfs') {
    const mk = await ctx.exec(['mkfs.xfs', '-f', '-L', label, dev])
    if (mk.code !== 0) throw new Error(`mkfs.xfs failed: ${mk.stderr.trim()}`)
    return
  }
  if (fs === 'ext4') {
    const mk = await ctx.exec(['mkfs.ext4', '-F', '-L', label, dev])
    if (mk.code !== 0) throw new Error(`mkfs.ext4 failed: ${mk.stderr.trim()}`)
    return
  }
  throw new Error(`unsupported data filesystem ${JSON.stringify(fs)} (want xfs|ext4)`)
}

/**
 * @param {StageContext} ctx
 * @param {DisksJson['data'][string]} vol
 */
async function mountDataVolume(ctx, vol) {
  const { id, mount, fs } = vol
  await mkdir(mount, { recursive: true })

  const mounted = await ctx.exec(['findmnt', '-n', mount])
  if (mounted.code === 0) {
    ctx.log(`rocky-data-mounts: ${mount} already mounted`)
    await writeFile(join(mount, '.qctl-data-ok'), '')
    return
  }

  const dev = await findDeviceBySerial(ctx, id)
  ctx.log(`rocky-data-mounts: ${id} → ${dev} (mount=${mount} fs=${fs})`)

  const fstypeR = await ctx.exec(['blkid', '-o', 'value', '-s', 'TYPE', dev])
  const existing = fstypeR.stdout.trim()
  /** @type {string} */
  let fstabFs = fs
  if (!existing) {
    ctx.log(`rocky-data-mounts: formatting ${dev} as ${fs} label=${id}`)
    await mkfsVolume(ctx, fs, id, dev)
    await ctx.exec(['udevadm', 'settle'])
    fstabFs = fs
  } else {
    // Existing filesystem: mount only — never reformat.
    ctx.log(`rocky-data-mounts: ${dev} already has ${existing} — mount only`)
    fstabFs = existing
  }

  const uuidR = await ctx.exec(['blkid', '-o', 'value', '-s', 'UUID', dev])
  const uuid = uuidR.stdout.trim()
  if (!uuid) throw new Error(`no UUID for ${dev}`)

  const fstabPath = ctx.env.ROCKY_FSTAB?.trim() || '/etc/fstab'
  const fstab = await Bun.file(fstabPath)
    .text()
    .catch(() => '')
  const fstabRe = new RegExp(`^[^#].*\\s${mount.replace(/\//g, '\\/')}\\s`)
  if (!fstab.split('\n').some((l) => fstabRe.test(l))) {
    ctx.log(`rocky-data-mounts: fstab UUID=${uuid} → ${mount} (${fstabFs})`)
    await appendFile(fstabPath, `UUID=${uuid} ${mount} ${fstabFs} defaults,nofail 0 2\n`)
  }

  const m = await ctx.exec(['mount', mount])
  if (m.code !== 0) throw new Error(`mount ${mount} failed: ${m.stderr.trim()}`)
  await writeFile(join(mount, '.qctl-data-ok'), '')
  ctx.log(`rocky-data-mounts: ${mount} ready on ${dev}`)
}

export default {
  name: 'data-mounts',
  describe: 'Mount disks.data volumes by serial (mkfs if blank; never reformat)',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    const path = ctx.env.ROCKY_DISKS_JSON?.trim() || '/usr/local/lib/rocky/disks.json'
    return [
      `read ${path}`,
      'for each disks.data volume: find disk by serial (= id)',
      'blank → mkfs(fs); existing FS → mount only (never reformat)',
      'fstab + mount',
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('data-mounts', 'must run as root')

    try {
      const disks = await loadDisksJson(ctx.env)
      if (!disks) {
        ctx.log('rocky-data-mounts: no disks.json — skipping')
        return
      }
      const vols = Object.values(disks.data)
      if (!vols.length) {
        ctx.log('rocky-data-mounts: no disks.data — skipping')
        return
      }
      for (const vol of vols) {
        await mountDataVolume(ctx, vol)
      }
    } catch (err) {
      throw new StageError('data-mounts', err instanceof Error ? err.message : String(err))
    }
  },
}
