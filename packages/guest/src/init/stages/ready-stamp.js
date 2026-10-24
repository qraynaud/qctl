import { hostname } from 'node:os'
import { join } from 'node:path'

import { StageError } from '../errors.js'
import { FIRST_BOOT_STAMP, mergeInitState, resolveQctlVarDir, writeThinStamp } from '../state.js'

/** @import { StageContext } from '../context.js' */
/** @import { Stage } from './types.js' */

/**
 * Paths for the ready stamp (defaults under `/var/lib/qctl`).
 *
 * @param {StageContext} ctx
 */
export function stampPaths(ctx) {
  const dir = resolveQctlVarDir(ctx.paths)
  return {
    dir,
    file: ctx.paths.firstBootStamp?.trim() || join(dir, FIRST_BOOT_STAMP),
    repoDir: ctx.osConfig.root?.trim() || '/tank/rocky',
    hgBin: ctx.paths.hgBin?.trim() || '/usr/local/bin/hg',
  }
}

/** @type {Stage} */
const stage = {
  name: 'ready-stamp',
  describe: 'Write init-state + /var/lib/qctl/first-boot.done so rocky-first-boot becomes a no-op',
  plan(ctx) {
    const p = stampPaths(ctx)
    return [
      `merge readyAt/hostname/hgId into init-state.json`,
      `write thin stamp ${p.file}`,
      `hg id via ${p.hgBin} -R ${p.repoDir} id -i`,
    ]
  },
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('ready-stamp', 'must run as root')
    const p = stampPaths(ctx)

    const hg = await ctx.exec([p.hgBin, '-R', p.repoDir, 'id', '-i'])
    if (hg.code !== 0) {
      throw new StageError(
        'ready-stamp',
        `hg id failed (rc=${hg.code}) for ${p.repoDir}: ${hg.stderr.trim()}`,
      )
    }

    const finishedAt = new Date().toISOString()
    const host = hostname()
    const hgId = hg.stdout.trim()
    mergeInitState(
      {
        profile: 'default',
        readyAt: finishedAt,
        hostname: host,
        hgId,
        checks: { tank: 'imported', vw: 'mounted' },
      },
      { paths: ctx.paths },
    )

    const body = `${[
      'ok',
      `finished_at=${finishedAt}`,
      `hostname=${host}`,
      `hg_id=${hgId}`,
      'tank=imported',
      'vw=mounted',
    ].join('\n')}\n`
    const written = writeThinStamp(FIRST_BOOT_STAMP, body, {
      paths: ctx.paths,
      primaryPath: p.file,
    })

    // Host may virsh-destroy immediately after Final Stage to detach serial —
    // flush so stamp/init-state survive the power cut.
    await ctx.exec(['sync'])

    ctx.log(`rocky-stamp: wrote init-state + ${written.join(', ')}`)
    ctx.log('rocky-stamp: first-boot complete — rocky-first-boot.service will not re-run')
    ctx.log(body.trimEnd())
  },
}

export default stage
