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
    .option('root', {
      type: 'string',
      describe: 'Instance root (default: $QCTL_ROOT, else walk up from cwd)',
    })
    .option('dry-run', { type: 'boolean', default: false, describe: 'Print actions only' })
    .option('restart', {
      type: 'boolean',
      default: false,
      describe: 'Restart apps whose secrets changed (omit from ExecStartPre)',
    })
    .option('env', {
      type: 'string',
      describe: 'Override QCTL_ENV for schema @import(..., enabled=eq($QCTL_ENV,…))',
    })
    .epilog(
      [
        'Prefers root via passwordless sudo (shared varlock plugin cache + rootful secrets).',
        'Without sudo (rootless ExecStartPre as apps): syncs the rootless store only.',
        'Podman secret name = schema key as-is (CADDY_DNS → CADDY_DNS).',
        'Store follows applications/<app>/app.yaml engine: (rootful → rootful store; else rootless).',
        'Tag `# @tag(cross-engine)` to write the secret into both stores (shared across engines).',
        'Unit schemas: applications/<app>/<unit>/.env.schema and common/<lib>/.env.schema.',
        'Labels each secret qctl.sha256=… so unchanged values are skipped; `secret check` compares them.',
        'Day-2 after vault changes: qctl secret check && qctl secret sync --restart',
        'Quadlet hook:  ExecStartPre=qctl secret sync --root ${REPO_ROOT}',
      ].join('\n'),
    )
}

/**
 * @param {SecretArgv} argv
 */
export async function handler(argv) {
  try {
    await runSecretCommand(argv, async (root) => {
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
