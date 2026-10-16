/**
 * init-tank profile: create tanks from disks.json topology, export, write stamp.
 * Encrypted pools: Tier-0 `tank_passphrase_<poolId>` → credstore key file.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { buildZpoolCreateArgv } from '@qctl/shared'

import { loadDisksJson } from '../disks-json.js'
import { StageError } from '../errors.js'
import { detectQctlEnv } from './lib/credentials.js'
import { diskBySerial } from './lib/disk-by-serial.js'
import {
  ensureTankPassphraseFromBootstrap,
  mustExec,
  tankCredFile,
  tankEnableBootUnlock,
  tankKeyLocation,
  tankPoolImportable,
  tankPoolImported,
  writeTankCanary,
} from './lib/tank.js'

/** @import { DisksJson } from '@qctl/shared' */
/** @import { StageContext } from '../context.js' */

/**
 * @typedef {{ role: string, type: string, devices: string[] }} ResolvedTankVdev
 */

/**
 * @param {StageContext} ctx
 * @param {DisksJson['tanks'][string]} tank
 * @returns {Promise<ResolvedTankVdev[]>}
 */
async function resolveTankVdevs(ctx, tank) {
  /** @type {ResolvedTankVdev[]} */
  const out = []
  for (const [vdevId, vdev] of Object.entries(tank.vdevs)) {
    /** @type {string[]} */
    const devices = []
    for (const member of Object.values(vdev.members)) {
      const dev = await diskBySerial(ctx, member.id)
      devices.push(dev)
      ctx.log(`tank-create: ${tank.id}/${vdevId}/${member.id} → ${dev}`)
    }
    out.push({ role: vdev.role, type: vdev.type, devices })
  }
  return out
}

/**
 * @param {StageContext} ctx
 * @param {DisksJson} disks
 * @returns {string[]}
 */
function poolsToCreate(ctx, disks) {
  const poolsEnv = ctx.env.ROCKY_INIT_TANK_POOLS?.trim()
  if (poolsEnv) {
    return poolsEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return Object.keys(disks.tanks)
}

/**
 * @param {StageContext} ctx
 * @param {DisksJson} disks
 * @param {string} poolId
 */
async function createOneTank(ctx, disks, poolId) {
  const tank = disks.tanks[poolId]
  if (!tank) {
    throw new Error(`disks.json has no tank ${JSON.stringify(poolId)}`)
  }
  const encrypted = disks.encryptedTankIds.includes(poolId)
  if (encrypted) {
    await ensureTankPassphraseFromBootstrap(ctx, 'tank-create', poolId)
  }

  if (await tankPoolImported(ctx, poolId)) {
    throw new Error(
      `pool ${poolId} already imported — aborting`
        + (ctx.env.ROCKY_INIT_TANK_FORCE === 'yes'
          ? ' (host -f should have wiped members)'
          : ' (pass host init-tank -f to recreate)'),
    )
  }
  if (await tankPoolImportable(ctx, poolId)) {
    throw new Error(
      `pool ${poolId} is importable on these disks — aborting`
        + (ctx.env.ROCKY_INIT_TANK_FORCE === 'yes'
          ? ' (host -f should have wiped members)'
          : ' (pass host init-tank -f to recreate)'),
    )
  }

  const vdevs = await resolveTankVdevs(ctx, tank)
  await ctx.exec(['udevadm', 'settle'])

  const encryption = encrypted ? { keylocation: tankKeyLocation(ctx, poolId) } : null
  const argv = buildZpoolCreateArgv({
    pool: tank.id,
    mount: tank.mount,
    options: tank.options,
    vdevs,
    encryption,
  })
  ctx.log(
    `tank-create: creating ${tank.id} at ${tank.mount}`
      + (encryption ? ` (encrypted keylocation=${encryption.keylocation})` : ' (unencrypted)'),
  )
  await mustExec(ctx, argv, `zpool create ${tank.id}`)

  await writeTankCanary(ctx, `${tank.mount}/.rocky-canary`, tank.mount)
  await tankEnableBootUnlock(ctx, tank.id, tank.mount)

  const status = await ctx.exec(['zpool', 'status', tank.id])
  for (const line of (status.stdout || '').split('\n').slice(0, 25)) {
    if (line) ctx.log(`tank-create: ${line}`)
  }

  ctx.log(`tank-create: exporting ${tank.id}…`)
  await mustExec(ctx, ['zpool', 'export', tank.id], `zpool export ${tank.id}`)
}

export default {
  name: 'tank-create',
  describe: 'init-tank: create tanks from disks.json, export, write stamp',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    return [
      'require ROCKY_TANK_CREATE_I_UNDERSTAND=yes',
      'read disks.json tanks (+ ROCKY_INIT_TANK_POOLS filter)',
      `ensure tank_passphrase_<poolId> for encrypted tanks (QCTL_ENV=${detectQctlEnv(ctx.env)})`,
      'zpool create from vdev role registry (options.pool / dataset / acl; no child datasets)',
      'export + stamp',
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
    const force = ctx.env.ROCKY_INIT_TANK_FORCE === 'yes'

    if (existsSync(stamp) && !force) {
      ctx.log(`tank-create: already done (${stamp}) — skipping create`)
      return
    }

    try {
      const disks = await loadDisksJson(ctx.env)
      if (!disks) throw new Error('disks.json missing — cannot create tanks')
      const poolIds = poolsToCreate(ctx, disks)
      if (!poolIds.length) {
        ctx.log('tank-create: no tanks in disks.json / ROCKY_INIT_TANK_POOLS — nothing to create')
        return
      }

      await mustExec(ctx, ['modprobe', 'zfs'], 'modprobe zfs')
      const zpoolBin = await ctx.exec(['bash', '-c', 'command -v zpool'])
      if (zpoolBin.code !== 0 || !zpoolBin.stdout.trim()) {
        throw new Error('zpool not installed')
      }

      ctx.log('tank-create: block devices (serials):')
      const lsblk = await ctx.exec(['lsblk', '-ndo', 'NAME,SIZE,SERIAL,TYPE'])
      for (const line of (lsblk.stdout || '').split('\n').filter(Boolean)) {
        ctx.log(`tank-create: ${line}`)
      }

      for (const poolId of poolIds) {
        await createOneTank(ctx, disks, poolId)
      }

      const when = new Date().toISOString()
      await mkdir(dirname(stamp), { recursive: true })
      await writeFile(stamp, `${when}\n`, { mode: 0o644 })
      await mkdir(dirname(okMarker), { recursive: true })
      await writeFile(okMarker, `${when}\n`, { mode: 0o644 })
      ctx.log(
        `tank-create: created + exported OK (${poolIds.join(', ')}); `
          + `later boots re-seed ${tankCredFile(ctx, poolIds[0])} from bootstrap`,
      )
    } catch (err) {
      if (err instanceof StageError) throw err
      throw new StageError('tank-create', err instanceof Error ? err.message : String(err))
    }
  },
}
