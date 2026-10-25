import { callSecret } from './rpc.js'
/** @import { Argv } from 'yargs' */
/** @import { SecretParams } from '../../supervisor/protocol.js' */
/** @import { SecretArgv } from './rpc.js' */

export const command = 'sync'
export const describe =
  'Resolve @sensitive via the varlock graph → podman secret create/replace (skip unchanged)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .option('app', {
      type: 'string',
      describe:
        'Limit to one app (+ common secrets it Secret=s); required for ExecStartPre as apps',
    })
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
        'Run as admin (or root).',
        'After vault changes: qctl secret check && qctl secret sync --restart',
        'Before start: ExecStartPre=qctl secret sync --app=<name>',
      ].join('\n'),
    )
}

/**
 * @param {SecretArgv} argv
 */
export async function handler(argv) {
  try {
    /** @type {SecretParams} */
    const params = {
      op: 'sync',
      dryRun: Boolean(argv.dryRun),
      restart: Boolean(argv.restart),
    }
    if (typeof argv.app === 'string' && argv.app) params.app = argv.app
    if (typeof argv.env === 'string' && argv.env) params.env = argv.env
    await callSecret(params)
  } catch (e) {
    console.error(`secret-sync: ERROR: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  }
}
