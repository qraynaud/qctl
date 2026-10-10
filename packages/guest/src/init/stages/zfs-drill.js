/**
 * Validate cold-handoff: export → import → load-key → mount → canary.
 * Skip with ROCKY_SKIP_ZFS_DRILL=1.
 */
import { readFile } from 'node:fs/promises'

import { StageError } from '../errors.js'
import {
  mustExec,
  tankCanary,
  tankEnableBootUnlock,
  tankEnsureKeyLoaded,
  tankEnsureMounted,
  tankEnsureSystemdMount,
  tankImportPool,
  tankMountUnit,
  tankPool,
  tankPoolImported,
  writeTankCanary,
} from './lib/tank.js'

/** @import { StageContext } from '../context.js' */

export default {
  name: 'zfs-drill',
  describe: 'ZFS export → import → unlock canary drill',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    if (ctx.env.ROCKY_SKIP_ZFS_DRILL === '1') {
      return ['skipped (ROCKY_SKIP_ZFS_DRILL=1)']
    }
    return [
      `export ${tankPool(ctx)}`,
      're-import + unlock + verify canary',
      'enable boot unlock cache',
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (ctx.env.ROCKY_SKIP_ZFS_DRILL === '1') {
      ctx.log('zfs-drill: skipped (ROCKY_SKIP_ZFS_DRILL=1)')
      return
    }
    if (!ctx.isRoot()) throw new StageError('zfs-drill', 'must run as root')

    const pool = tankPool(ctx)
    const canary = tankCanary(ctx)

    try {
      await mustExec(ctx, ['modprobe', 'zfs'], 'modprobe zfs')
      if (!(await tankPoolImported(ctx))) {
        throw new Error(`pool ${pool} not imported — run the tank-import stage first`)
      }
      await tankEnsureKeyLoaded(ctx)
      await tankEnsureMounted(ctx)

      let before
      try {
        before = await readFile(canary, 'utf8')
      } catch {
        ctx.log('zfs-drill: canary missing; writing one before drill')
        await writeTankCanary(ctx, canary)
        before = await readFile(canary, 'utf8')
      }
      if (!before.trim()) throw new Error(`canary empty at ${canary}`)
      ctx.log(`zfs-drill: canary before export: ${before.replace(/\n/g, ' ').trim()}`)

      ctx.log(`zfs-drill: exporting ${pool} (mirrors prod cold handoff)`)
      const mountUnit = await tankMountUnit(ctx)
      await ctx.exec(['systemctl', 'stop', mountUnit])
      await ctx.exec(['systemctl', 'stop', `zfs-load-key@${pool}.service`])
      await mustExec(ctx, ['zpool', 'export', pool], `zpool export ${pool}`)
      if (await tankPoolImported(ctx)) {
        throw new Error(`pool ${pool} still imported after export`)
      }
      ctx.log('zfs-drill: export OK')

      // Import + zfs mount + reactivate systemd tank.mount (stop above leaves it dead).
      await tankImportPool(ctx)
      await tankEnsureSystemdMount(ctx)

      const after = await readFile(canary, 'utf8')
      if (after !== before) {
        throw new Error(`canary mismatch after drill\n  before: ${before}\n  after:  ${after}`)
      }
      ctx.log('zfs-drill: canary intact after export→import→unlock')
      await tankEnableBootUnlock(ctx)
      const status = await ctx.exec(['zpool', 'status', pool])
      for (const line of (status.stdout || '').split('\n').slice(0, 20)) {
        if (line) ctx.log(`zfs-drill: ${line}`)
      }
      ctx.log('zfs-drill: done (Gate 5 path OK)')
    } catch (err) {
      throw new StageError('zfs-drill', err instanceof Error ? err.message : String(err))
    }
  },
}
