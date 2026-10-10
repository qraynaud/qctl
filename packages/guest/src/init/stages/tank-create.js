/**
 * init-tank profile: create encrypted tank, export, write stamp.
 * Reseeds key file from bootstrap `TANK_PASSPHRASE` when missing.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { StageError } from '../errors.js'
import { detectQctlEnv } from './lib/credentials.js'
import {
  ensureTankPassphraseFromBootstrap,
  mustExec,
  tankCredFile,
  tankEnableBootUnlock,
  tankKeyLocation,
  tankMount,
  tankPool,
  tankPoolImportable,
  tankPoolImported,
  writeTankCanary,
} from './lib/tank.js'

/** @import { StageContext } from '../context.js' */

/**
 * @param {StageContext} ctx
 * @param {string} serial
 * @returns {Promise<string>}
 */
async function diskBySerial(ctx, serial) {
  const byId = await ctx.exec([
    'bash',
    '-c',
    `serial="$1"
     for c in /dev/disk/by-id/*"$serial"*; do
       [[ -e "$c" && ! "$c" =~ -part[0-9]+$ ]] || continue
       readlink -f "$c"
       exit 0
     done
     exit 1`,
    'disk-by-serial',
    serial,
  ])
  if (byId.code === 0 && byId.stdout.trim()) return byId.stdout.trim()

  const lsblk = await ctx.exec(['lsblk', '-ndo', 'NAME,SERIAL,TYPE'])
  for (const line of (lsblk.stdout || '').split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 3) continue
    const [name, ser, type] = parts
    if (ser === serial && type === 'disk') return `/dev/${name}`
  }
  throw new Error(`missing disk serial ${serial}`)
}

/**
 * @param {StageContext} ctx
 */
async function requireVdevDisks(ctx) {
  const dataPrefix = ctx.env.ROCKY_DATA_SERIAL_PREFIX?.trim() || 'rocky-data'
  const specialPrefix = ctx.env.ROCKY_SPECIAL_SERIAL_PREFIX?.trim() || 'rocky-special'
  const dataCount = Number(ctx.env.ROCKY_DATA_COUNT || 5)
  const specialCount = Number(ctx.env.ROCKY_SPECIAL_COUNT || 2)
  /** @type {string[]} */
  const dataDisks = []
  /** @type {string[]} */
  const specialDisks = []
  for (let i = 0; i < dataCount; i++) {
    const dev = await diskBySerial(ctx, `${dataPrefix}${i}`)
    dataDisks.push(dev)
    ctx.log(`tank-create: data${i} → ${dev}`)
  }
  for (let i = 0; i < specialCount; i++) {
    const dev = await diskBySerial(ctx, `${specialPrefix}${i}`)
    specialDisks.push(dev)
    ctx.log(`tank-create: special${i} → ${dev}`)
  }
  return { dataDisks, specialDisks }
}

export default {
  name: 'tank-create',
  describe: 'init-tank: create encrypted tank, export, write init-tank stamp',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    return [
      'require ROCKY_TANK_CREATE_I_UNDERSTAND=yes',
      `ensure ${tankCredFile(ctx)} from Tier-0 TANK_PASSPHRASE (QCTL_ENV=${detectQctlEnv(ctx.env)})`,
      `create encrypted ${tankPool(ctx)} (raidz2 + special mirror), export, stamp`,
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('tank-create', 'must run as root')
    if (ctx.env.ROCKY_TANK_CREATE_I_UNDERSTAND !== 'yes') {
      throw new StageError(
        'tank-create',
        'refusing to create: set ROCKY_TANK_CREATE_I_UNDERSTAND=yes (dedicated init VM / empty disks only)',
      )
    }

    const stamp = ctx.env.ROCKY_INIT_TANK_STAMP?.trim() || '/var/lib/rocky/init-tank-done'
    const okMarker = ctx.env.ROCKY_INIT_TANK_OK?.trim() || '/vw/.rocky-init-tank-ok'
    const pool = tankPool(ctx)
    const mount = tankMount(ctx)

    if (existsSync(stamp)) {
      ctx.log(`tank-create: already done (${stamp}) — skipping create`)
      return
    }

    try {
      await ensureTankPassphraseFromBootstrap(ctx, 'tank-create')
      await mustExec(ctx, ['modprobe', 'zfs'], 'modprobe zfs')
      const zpoolBin = await ctx.exec(['bash', '-c', 'command -v zpool'])
      if (zpoolBin.code !== 0 || !zpoolBin.stdout.trim()) {
        throw new Error('zpool not installed')
      }

      if (await tankPoolImported(ctx)) {
        throw new Error(`pool ${pool} already imported — aborting (will not recreate)`)
      }
      if (await tankPoolImportable(ctx)) {
        throw new Error(`pool ${pool} is importable on these disks — aborting (will not wipe)`)
      }

      const { dataDisks, specialDisks } = await requireVdevDisks(ctx)
      await ctx.exec(['udevadm', 'settle'])
      ctx.log('tank-create: block devices (serials):')
      const lsblk = await ctx.exec(['lsblk', '-ndo', 'NAME,SIZE,SERIAL,TYPE'])
      for (const line of (lsblk.stdout || '').split('\n').filter(Boolean)) {
        ctx.log(`tank-create: ${line}`)
      }

      const keyLoc = tankKeyLocation(ctx)
      ctx.log(`tank-create: creating encrypted ${pool} (keylocation=${keyLoc})`)
      await mustExec(
        ctx,
        [
          'zpool',
          'create',
          '-f',
          '-O',
          `mountpoint=${mount}`,
          '-O',
          'compression=lz4',
          '-O',
          'atime=off',
          '-O',
          'xattr=sa',
          '-O',
          'acltype=posixacl',
          '-O',
          'dnodesize=auto',
          '-O',
          'encryption=aes-256-gcm',
          '-O',
          'keyformat=passphrase',
          '-O',
          `keylocation=${keyLoc}`,
          pool,
          'raidz2',
          ...dataDisks,
        ],
        'zpool create',
      )
      await mustExec(
        ctx,
        ['zpool', 'add', '-f', pool, 'special', 'mirror', ...specialDisks],
        'zpool add special mirror',
      )
      await ctx.exec(['zfs', 'create', '-o', 'mountpoint=none', `${pool}/apps`])
      await writeTankCanary(ctx, `${mount}/.rocky-canary`)
      await tankEnableBootUnlock(ctx)

      const status = await ctx.exec(['zpool', 'status', pool])
      for (const line of (status.stdout || '').split('\n').slice(0, 25)) {
        if (line) ctx.log(`tank-create: ${line}`)
      }

      ctx.log(`tank-create: exporting ${pool}…`)
      await mustExec(ctx, ['zpool', 'export', pool], `zpool export ${pool}`)

      const when = new Date().toISOString()
      await mkdir(dirname(stamp), { recursive: true })
      await writeFile(stamp, `${when}\n`, { mode: 0o644 })
      await mkdir(dirname(okMarker), { recursive: true })
      await writeFile(okMarker, `${when}\n`, { mode: 0o644 })
      ctx.log(
        `tank-create: created + exported OK; later boots re-seed ${tankCredFile(ctx)} from bootstrap`,
      )
    } catch (err) {
      if (err instanceof StageError) throw err
      throw new StageError('tank-create', err instanceof Error ? err.message : String(err))
    }
  },
}
