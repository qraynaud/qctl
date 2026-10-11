/**
 * Import + unlock encrypted ZFS pool. Never creates or destroys a pool.
 * Reseeds `/etc/credstore/rocky/tank_passphrase` from bootstrap `TANK_PASSPHRASE` when missing.
 */
import { StageError } from '../errors.js'
import { detectQctlEnv } from './lib/credentials.js'
import {
  ensureTankPassphraseFromBootstrap,
  mustExec,
  tankCredFile,
  tankEnsureKeyLoaded,
  tankEnsureMounted,
  tankImportPool,
  tankPool,
  tankPoolImportable,
  tankPoolImported,
  writeTankCanary,
} from './lib/tank.js'

/** @import { StageContext } from '../context.js' */

export default {
  name: 'tank-import',
  describe: 'Import + unlock encrypted ZFS pool (reseed key from bootstrap if needed)',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    return [
      `ensure ${tankCredFile(ctx)} from Tier-0 TANK_PASSPHRASE (QCTL_ENV=${detectQctlEnv(ctx.env)})`,
      `import/unlock ${tankPool(ctx)} (never create)`,
      'write canary under mount',
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('tank-import', 'must run as root')
    const pool = tankPool(ctx)
    ctx.log(`tank-import: start (import-only; never creates)`)

    try {
      await ensureTankPassphraseFromBootstrap(ctx, 'tank-import')
      await mustExec(ctx, ['modprobe', 'zfs'], 'modprobe zfs')

      if (await tankPoolImported(ctx)) {
        ctx.log(`tank-import: pool ${pool} already imported`)
        await tankEnsureKeyLoaded(ctx)
        await tankEnsureMounted(ctx)
      } else if (await tankPoolImportable(ctx)) {
        await tankImportPool(ctx)
      } else {
        throw new Error(
          `no importable pool '${pool}'. Init on a dedicated VM (qctl vm init-tank), then attach the same disks here.`,
        )
      }

      await writeTankCanary(ctx)
      const status = await ctx.exec(['zpool', 'status', pool])
      if (status.stdout) {
        for (const line of status.stdout.split('\n').slice(0, 20)) {
          if (line) ctx.log(`tank-import: ${line}`)
        }
      }
      ctx.log('tank-import: done')
    } catch (err) {
      throw new StageError('tank-import', err instanceof Error ? err.message : String(err))
    }
  },
}
