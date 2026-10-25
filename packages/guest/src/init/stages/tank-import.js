/**
 * Import + unlock ZFS tanks from disks.json. Never creates or destroys a pool.
 * Encrypted pools: Tier-0 `tank_passphrase_<poolId>` → credstore key file.
 */
import { resolveDisks } from '../disks-json.js'
import { StageError } from '../errors.js'
import { mergeInitState } from '../state.js'
import { detectQctlEnv } from './lib/credentials.js'
import {
  ensureTankPassphraseFromBootstrap,
  mustExec,
  tankAssertZfsMounted,
  tankCredFile,
  tankEnableBootUnlock,
  tankEnsureKeyLoaded,
  tankEnsureMounted,
  tankEnsureSystemdMount,
  tankImportPool,
  tankPoolImportable,
  tankPoolImported,
} from './lib/tank.js'

/** @import { DisksJson } from '@qctl/shared' */
/** @import { StageContext } from '../context.js' */

/**
 * @param {StageContext} ctx
 * @param {DisksJson} disks
 * @param {string} poolId
 */
async function importOneTank(ctx, disks, poolId) {
  const tank = disks.tanks[poolId]
  if (!tank) throw new Error(`disks.json has no tank ${JSON.stringify(poolId)}`)
  const encrypted = disks.encryptedTankIds.includes(poolId)

  if (encrypted) {
    await ensureTankPassphraseFromBootstrap(ctx, 'tank-import', poolId)
  }

  if (await tankPoolImported(ctx, poolId)) {
    ctx.log(`tank-import: pool ${poolId} already imported`)
    if (encrypted) await tankEnsureKeyLoaded(ctx, poolId)
    await tankEnsureMounted(ctx, poolId, tank.mount)
    await tankEnsureSystemdMount(ctx, poolId, tank.mount)
  } else if (await tankPoolImportable(ctx, poolId)) {
    await tankImportPool(ctx, poolId, tank.mount)
  } else {
    throw new Error(
      `no importable pool '${poolId}'. Init on a dedicated VM (qctl vm init-tank), `
        + `then attach the same disks here.`,
    )
  }

  // Appliance OS is fresh; init-tank's zfs-list.cache did not survive. Do not
  // rely on zfs-drill alone (it can be skipped) for reboot remount.
  await tankEnableBootUnlock(ctx, poolId, tank.mount)

  mergeInitState(
    {
      tanks: {
        [poolId]: { mount: tank.mount, importedAt: new Date().toISOString() },
      },
    },
    { paths: ctx.paths },
  )

  // Final gate before later stages (hg-clone): must be a real ZFS mount, not
  // an OS-disk placeholder under tank.mount.
  await tankAssertZfsMounted(ctx, poolId, tank.mount)
  ctx.log(`tank-import: verified ${poolId} mounted at ${tank.mount} (zfs)`)

  const status = await ctx.exec(['zpool', 'status', poolId])
  if (status.stdout) {
    for (const line of status.stdout.split('\n').slice(0, 20)) {
      if (line) ctx.log(`tank-import: ${line}`)
    }
  }
}

export default {
  name: 'tank-import',
  describe: 'Import + unlock disks.json tanks (never create)',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    return [
      'read disks.json tanks',
      `ensure tank_passphrase_<poolId> for encrypted tanks (QCTL_ENV=${detectQctlEnv(ctx.osConfig)})`,
      'import/unlock each pool (never create); mount from topology',
      'enable zfs-list.cache / zfs-load-key@<pool> for reboot remount',
      'assert each tank.mount is zfs + zfs mounted=yes (fail closed)',
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('tank-import', 'must run as root')
    ctx.log('tank-import: start (import-only; never creates)')

    try {
      const disks = resolveDisks(ctx.seedConfig?.disks)
      if (!disks) throw new Error('disks.json missing — cannot import tanks')
      const poolIds = Object.keys(disks.tanks)
      if (!poolIds.length) {
        ctx.log('tank-import: no tanks in disks.json — skipping')
        return
      }

      await mustExec(ctx, ['modprobe', 'zfs'], 'modprobe zfs')

      for (const poolId of poolIds) {
        ctx.log(`tank-import: ${poolId} → ${disks.tanks[poolId].mount}`)
        await importOneTank(ctx, disks, poolId)
      }

      ctx.log(
        `tank-import: done (${poolIds.join(', ')}); keys under ${tankCredFile(ctx, poolIds[0])}`,
      )
    } catch (err) {
      throw new StageError('tank-import', err instanceof Error ? err.message : String(err))
    }
  },
}
