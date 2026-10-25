/**
 * Validate cold-handoff per disks.json tank: export → import → load-key → mount.
 * Skip with ROCKY_SKIP_ZFS_DRILL=1.
 */
import { resolveDisks } from '../disks-json.js'
import { StageError } from '../errors.js'
import { mergeInitState } from '../state.js'
import {
  mustExec,
  tankAssertZfsMounted,
  tankEnableBootUnlock,
  tankEnsureKeyLoaded,
  tankEnsureMounted,
  tankEnsureSystemdMount,
  tankImportPool,
  tankMountUnit,
  tankPoolImported,
} from './lib/tank.js'

/** @import { DisksJson } from '@qctl/shared' */
/** @import { StageContext } from '../context.js' */

/**
 * @param {StageContext} ctx
 * @param {DisksJson} disks
 * @param {string} poolId
 */
async function drillOneTank(ctx, disks, poolId) {
  const tank = disks.tanks[poolId]
  if (!tank) throw new Error(`disks.json has no tank ${JSON.stringify(poolId)}`)
  const encrypted = disks.encryptedTankIds.includes(poolId)

  if (!(await tankPoolImported(ctx, poolId))) {
    throw new Error(`pool ${poolId} not imported — run the tank-import stage first`)
  }
  if (encrypted) await tankEnsureKeyLoaded(ctx, poolId)
  await tankEnsureMounted(ctx, poolId, tank.mount)
  await tankAssertZfsMounted(ctx, poolId, tank.mount)

  ctx.log(`zfs-drill: exporting ${poolId} (mirrors prod cold handoff)`)
  const mountUnit = await tankMountUnit(ctx, tank.mount)
  await ctx.exec(['systemctl', 'stop', mountUnit])
  await ctx.exec(['systemctl', 'stop', `zfs-load-key@${poolId}.service`])
  await mustExec(ctx, ['zpool', 'export', poolId], `zpool export ${poolId}`)
  if (await tankPoolImported(ctx, poolId)) {
    throw new Error(`pool ${poolId} still imported after export`)
  }
  // Wait for systemd's Unmounting to finish before re-import.
  for (let i = 0; i < 40; i++) {
    const find = await ctx.exec(['findmnt', '-n', tank.mount])
    if (find.code !== 0) break
    if (i === 0) ctx.log(`zfs-drill: waiting for ${tank.mount} unmount to settle`)
    await new Promise((r) => setTimeout(r, 100))
  }
  ctx.log(`zfs-drill: ${poolId} export OK`)

  await tankImportPool(ctx, poolId, tank.mount)
  await tankEnsureSystemdMount(ctx, poolId, tank.mount)
  await tankAssertZfsMounted(ctx, poolId, tank.mount)

  const verifiedAt = new Date().toISOString()
  mergeInitState(
    {
      tanks: {
        [poolId]: {
          mount: tank.mount,
          drillVerifiedAt: verifiedAt,
        },
      },
    },
    { paths: ctx.paths },
  )
  ctx.log(`zfs-drill: ${poolId} remounted after export→import→unlock`)
  await tankEnableBootUnlock(ctx, poolId, tank.mount)
  const status = await ctx.exec(['zpool', 'status', poolId])
  for (const line of (status.stdout || '').split('\n').slice(0, 20)) {
    if (line) ctx.log(`zfs-drill: ${line}`)
  }
}

export default {
  name: 'zfs-drill',
  describe: 'ZFS export → import → unlock remount drill (per disks.json tank)',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    if (ctx.flags.skipZfsDrill) {
      return ['skipped (ROCKY_SKIP_ZFS_DRILL=1)']
    }
    return [
      'read disks.json tanks',
      'per pool: export → re-import + unlock + assert remount',
      'enable boot unlock cache',
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (ctx.flags.skipZfsDrill) {
      ctx.log('zfs-drill: skipped (ROCKY_SKIP_ZFS_DRILL=1)')
      return
    }
    if (!ctx.isRoot()) throw new StageError('zfs-drill', 'must run as root')

    try {
      const disks = resolveDisks(ctx.seedConfig?.disks)
      if (!disks) throw new Error('disks.json missing — cannot run zfs-drill')
      const poolIds = Object.keys(disks.tanks)
      if (!poolIds.length) {
        ctx.log('zfs-drill: no tanks in disks.json — skipping')
        return
      }

      await mustExec(ctx, ['modprobe', 'zfs'], 'modprobe zfs')
      for (const poolId of poolIds) {
        await drillOneTank(ctx, disks, poolId)
      }
      ctx.log(`zfs-drill: done (Gate 5 path OK) for ${poolIds.join(', ')}`)
    } catch (err) {
      throw new StageError('zfs-drill', err instanceof Error ? err.message : String(err))
    }
  },
}
