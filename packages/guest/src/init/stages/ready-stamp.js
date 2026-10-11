import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { StageError } from '../errors.js'

/** @import { StageContext } from '../context.js' */
/** @import { Stage } from './types.js' */

/**
 * `QCTL_*` wins; the `ROCKY_*` names are what the seed/cloud-init still bakes
 * (kept readable until the rename lands).
 *
 * @param {StageContext} ctx
 */
export function stampPaths(ctx) {
  const e = ctx.env
  const dir = e.QCTL_STAMP_DIR ?? e.ROCKY_STAMP_DIR ?? '/var/lib/rocky'
  return {
    dir,
    file: e.QCTL_STAMP_FILE ?? e.ROCKY_STAMP_FILE ?? join(dir, 'first-boot.done'),
    repoDir: e.QCTL_REPO_DIR ?? e.ROCKY_REPO_DIR ?? '/tank/rocky',
    hgBin: e.QCTL_HG_BIN ?? e.ROCKY_HG_BIN ?? '/usr/local/bin/hg',
  }
}

/** @type {Stage} */
const stage = {
  name: 'ready-stamp',
  describe: 'Write /var/lib/rocky/first-boot.done so rocky-first-boot becomes a no-op',
  plan(ctx) {
    const p = stampPaths(ctx)
    return [
      `write ${p.file} (ok, finished_at, hostname, hg_id of ${p.repoDir}, tank=imported, bw=mounted)`,
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

    await mkdir(p.dir, { recursive: true })
    const body = `${[
      'ok',
      `finished_at=${new Date().toISOString()}`,
      `hostname=${hostname()}`,
      `hg_id=${hg.stdout.trim()}`,
      'tank=imported',
      'vw=mounted',
    ].join('\n')}\n`
    await writeFile(p.file, body)
    await chmod(p.file, 0o644)

    ctx.log(`rocky-stamp: wrote ${p.file}`)
    ctx.log('rocky-stamp: first-boot complete — rocky-first-boot.service will not re-run')
    ctx.log(body.trimEnd())
  },
}

export default stage
