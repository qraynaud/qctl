import { resolve } from 'node:path'

import { runSecretCommand } from '../../secret/cli.js'
import { runSecretSync } from '../../secret/sync.js'
/** @import { Argv } from 'yargs' */
/** @import { SecretArgv } from '../../secret/cli.js' */

export const command = 'sync'
export const describe =
  'Resolve @sensitive via the varlock graph → podman secret create/replace (skip unchanged)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .option('dry-run', { type: 'boolean', default: false, describe: 'Print actions only' })
    .option('restart', {
      type: 'boolean',
      default: false,
      describe: 'Restart apps whose secrets changed (omit from ExecStartPre)',
    })
    .option('env', {
      type: 'string',
      describe: 'Override env label for schema @import',
    })
    .epilog(
      [
        'Prefers root via passwordless sudo; without sudo, syncs the rootless store only.',
        'After vault changes: qctl secret check && qctl secret sync --restart',
        'Quadlet hook: ExecStartPre=qctl secret sync',
      ].join('\n'),
    )
}

/**
 * @param {SecretArgv} argv
 */
export async function handler(argv) {
  try {
    await runSecretCommand(async (root) => {
      await runSecretSync({
        root: resolve(root),
        dryRun: Boolean(argv.dryRun),
        restart: Boolean(argv.restart),
        qctlEnv: typeof argv.env === 'string' ? argv.env : undefined,
      })
    })
  } catch (e) {
    console.error(`secret-sync: ERROR: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  }
}
