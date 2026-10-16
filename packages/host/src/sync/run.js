/**
 * `qctl sync` orchestration.
 */
import { chalk } from 'zx'

import { loadEnvProvisionOrThrow } from '../lib/load-config.js'
import { tryGetRepoRoot } from '../lib/paths.js'
import { resolveProfileArgv } from '../lib/profile-argv.js'
import { errMessage } from '../lib/util.js'
import { parsePlatformRef } from '../tooling/platform-ref.js'
import { logEndpoint, resolveSyncEndpoint } from './endpoint.js'
import { SYNC_TAR_EXCLUDES, syncRepo } from './repo.js'
import { withSsh } from './ssh.js'
import { resolveGuestToolingForSync, syncTooling } from './tooling.js'

/** @import { VmArgv } from '../vm/types.js' */

/**
 * @param {VmArgv & {
 *   user?: string
 *   host?: string
 *   port?: number
 *   remoteDir?: string
 *   identity?: string
 *   includeTooling?: boolean
 *   delete?: boolean
 * }} argv
 */
export async function runSync(argv) {
  try {
    const root = tryGetRepoRoot()
    if (!root) {
      throw new Error(
        'not inside a qctl instance repo (no provision/*.yaml with a qctl: block).\n'
          + '  Run `qctl init <dir>` or cd into an existing instance.',
      )
    }
    resolveProfileArgv(argv, { root })
    const ep = await resolveSyncEndpoint(argv)
    logEndpoint(ep)
    const doDelete = argv.delete !== false

    if (argv.dryRun) {
      console.log(chalk.dim(`  [dry-run] archive ${root} → ${ep.remoteDir}`))
      console.log(chalk.dim(`  [dry-run] excludes: ${SYNC_TAR_EXCLUDES.join(', ')}`))
      console.log(chalk.dim(`  [dry-run] delete: ${doDelete ? 'yes' : 'no'}`))
      if (argv.includeTooling) {
        try {
          let platformModule = parsePlatformRef('rocky').moduleFile
          try {
            const sec = await loadEnvProvisionOrThrow({
              env: argv.env || 'dev',
              target: argv.target || 'local',
            })
            platformModule = parsePlatformRef(sec.platform).moduleFile
          } catch {
            // default rocky
          }
          const t = await resolveGuestToolingForSync({
            platformModule,
            env: argv.env,
            target: argv.target,
          })
          console.log(chalk.dim(`  [dry-run] tooling ← ${t.sourceLabel}`))
          for (const f of t.files) {
            console.log(chalk.dim(`  [dry-run] ${f.local} → ${f.installAs}`))
          }
          if (t.bootstrapDir) {
            console.log(
              chalk.dim(`  [dry-run] ${t.bootstrapDir}/ → /usr/local/lib/qctl/bootstrap/`),
            )
          }
        } catch (e) {
          console.log(chalk.dim(`  [dry-run] tooling: ${errMessage(e)}`))
        }
      }
      console.log(chalk.green('sync: dry-run done'))
      return
    }

    await withSsh(
      {
        host: ep.host,
        port: ep.port,
        username: ep.username,
        identity: ep.identity,
      },
      async (conn) => {
        await syncRepo(conn, {
          localRoot: root,
          remoteDir: ep.remoteDir,
          delete: doDelete,
        })
        if (argv.includeTooling) {
          await syncTooling(conn, { env: argv.env, target: argv.target })
        }
      },
    )
    console.log(chalk.green('sync: done'))
  } catch (err) {
    console.error(chalk.red(`sync: ${errMessage(err)}`))
    process.exitCode = 1
  }
}
