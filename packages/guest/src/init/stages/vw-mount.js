/**
 * Find/format/mount the /vw XFS disk (Vaultwarden CLI apodata).
 */
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, readlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { StageError } from '../errors.js'

/** @import { StageContext } from '../context.js' */

/**
 * @param {StageContext} ctx
 */
function vwConfig(ctx) {
  return {
    mount: ctx.env.ROCKY_VW_MOUNT?.trim() || '/vw',
    label: ctx.env.ROCKY_VW_LABEL?.trim() || 'rocky-vw',
    serial: ctx.env.ROCKY_VW_SERIAL?.trim() || 'rocky-vw',
    disk: ctx.env.ROCKY_VW_DISK?.trim() || '',
  }
}

/**
 * @param {StageContext} ctx
 * @param {ReturnType<typeof vwConfig>} cfg
 * @returns {Promise<string>}
 */
async function findVwDevice(ctx, cfg) {
  if (cfg.disk) {
    const st = await ctx.exec(['bash', '-c', `[[ -b "$1" ]]`, '_', cfg.disk])
    if (st.code !== 0) {
      throw new Error(`ROCKY_VW_DISK=${cfg.disk} is not a block device`)
    }
    return cfg.disk
  }

  const byIdDir = '/dev/disk/by-id'
  if (existsSync(byIdDir)) {
    for (const name of await readdir(byIdDir)) {
      if (!name.includes(cfg.serial)) continue
      if (/-part[0-9]+$/.test(name)) continue
      const candidate = join(byIdDir, name)
      if (!existsSync(candidate)) continue
      const resolved = await readlink(candidate).catch(() => '')
      const abs = resolved
        ? resolved.startsWith('/')
          ? resolved
          : join(byIdDir, resolved)
        : candidate
      const real = await ctx.exec(['readlink', '-f', candidate])
      if (real.code === 0 && real.stdout.trim()) return real.stdout.trim()
      if (abs) return abs
    }
  }

  const lsblk = await ctx.exec(['lsblk', '-ndo', 'NAME,SERIAL,TYPE'])
  if (lsblk.code === 0) {
    for (const line of lsblk.stdout.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 3) continue
      const [name, serial, type] = parts
      if (serial === cfg.serial && type === 'disk' && name) {
        return `/dev/${name}`
      }
    }
  }

  const byLabel = `/dev/disk/by-label/${cfg.label}`
  if (existsSync(byLabel)) {
    const real = await ctx.exec(['readlink', '-f', byLabel])
    if (real.code === 0 && real.stdout.trim()) return real.stdout.trim()
  }

  throw new Error(`no /vw disk found (expected serial ${cfg.serial}; set ROCKY_VW_DISK=)`)
}

export default {
  name: 'vw-mount',
  describe: 'Find/format/mount the /vw XFS disk (Vaultwarden CLI apodata)',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    const c = vwConfig(ctx)
    return [
      `find disk (serial=${c.serial} or ROCKY_VW_DISK)`,
      `format XFS label=${c.label} if blank`,
      `fstab + mount ${c.mount}`,
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('vw-mount', 'must run as root')
    const cfg = vwConfig(ctx)

    try {
      await mkdir(cfg.mount, { recursive: true })

      const mounted = await ctx.exec(['findmnt', '-n', cfg.mount])
      if (mounted.code === 0) {
        ctx.log(`rocky-vw-mount: ${cfg.mount} already mounted`)
        await writeFile(join(cfg.mount, '.rocky-vw-ok'), '')
        return
      }

      const dev = await findVwDevice(ctx, cfg)
      ctx.log(`rocky-vw-mount: using /vw device ${dev}`)

      const fstypeR = await ctx.exec(['blkid', '-o', 'value', '-s', 'TYPE', dev])
      const fstype = fstypeR.stdout.trim()
      if (!fstype) {
        ctx.log(`rocky-vw-mount: formatting ${dev} as XFS label=${cfg.label}`)
        const mk = await ctx.exec(['mkfs.xfs', '-f', '-L', cfg.label, dev])
        if (mk.code !== 0) throw new Error(`mkfs.xfs failed: ${mk.stderr.trim()}`)
        await ctx.exec(['udevadm', 'settle'])
      } else if (fstype !== 'xfs') {
        throw new Error(`${dev} has filesystem type ${fstype} (want xfs or empty)`)
      }

      const uuidR = await ctx.exec(['blkid', '-o', 'value', '-s', 'UUID', dev])
      const uuid = uuidR.stdout.trim()
      if (!uuid) throw new Error(`no UUID for ${dev} after format`)

      const fstab = await Bun.file('/etc/fstab')
        .text()
        .catch(() => '')
      const fstabRe = new RegExp(`^[^#].*\\s${cfg.mount.replace(/\//g, '\\/')}\\s`)
      if (!fstab.split('\n').some((l) => fstabRe.test(l))) {
        ctx.log(`rocky-vw-mount: adding fstab entry for UUID=${uuid} → ${cfg.mount}`)
        await appendFile('/etc/fstab', `UUID=${uuid} ${cfg.mount} xfs defaults,nofail 0 2\n`)
      }

      const m = await ctx.exec(['mount', cfg.mount])
      if (m.code !== 0) throw new Error(`mount ${cfg.mount} failed: ${m.stderr.trim()}`)
      await writeFile(join(cfg.mount, '.rocky-vw-ok'), '')
      ctx.log(`rocky-vw-mount: ${cfg.mount} ready on ${dev}`)
    } catch (err) {
      throw new StageError('vw-mount', err instanceof Error ? err.message : String(err))
    }
  },
}
