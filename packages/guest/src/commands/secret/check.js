import { resolve } from 'node:path'

import { runSecretCheck } from '../../secret/check.js'
import { runSecretCommand } from '../../secret/cli.js'
/** @import { Argv } from 'yargs' */
/** @import { SecretArgv } from '../../secret/cli.js' */

export const command = 'check'
export const describe =
  'Compare graph-resolved @sensitive values to Podman secrets (qctl.sha256 labels); exit 1 on drift'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .option('root', {
      type: 'string',
      describe: 'Instance root ($QCTL_ROOT, else cwd walk-up, else /tank/rocky)',
    })
    .option('env', {
      type: 'string',
      describe: 'Override QCTL_ENV for schema @import (default: detect from process / .env)',
    })
    .epilog(
      [
        'Prefers root via passwordless sudo; without sudo, checks the rootless store only.',
        'Uses the same discovery as `secret sync`. Does not write secrets.',
        'On drift: qctl secret sync --restart',
      ].join('\n'),
    )
}

/**
 * @param {SecretArgv} argv
 */
export async function handler(argv) {
  try {
    await runSecretCommand(argv, async (root) => {
      const report = await runSecretCheck({
        root: resolve(root),
        qctlEnv: typeof argv.env === 'string' ? argv.env : undefined,
      })
      if (!report.ok) process.exitCode = 1
    })
  } catch (e) {
    console.error(`secret-check: ERROR: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  }
}
