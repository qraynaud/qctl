import { callSecret } from './rpc.js'
/** @import { Argv } from 'yargs' */
/** @import { SecretParams } from '../../supervisor/protocol.js' */
/** @import { SecretArgv } from './rpc.js' */

export const command = 'check'
export const describe =
  'Compare graph-resolved @sensitive values to Podman secrets (qctl.sha256 labels); exit 1 on drift'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .option('app', {
      type: 'string',
      describe: 'Limit to one app (+ common secrets it Secret=s)',
    })
    .option('env', {
      type: 'string',
      describe: 'Override env label for schema @import',
    })
    .epilog('On drift: qctl secret sync --restart')
}

/**
 * @param {SecretArgv} argv
 */
export async function handler(argv) {
  try {
    /** @type {SecretParams} */
    const params = { op: 'check' }
    if (typeof argv.app === 'string' && argv.app) params.app = argv.app
    if (typeof argv.env === 'string' && argv.env) params.env = argv.env
    await callSecret(params)
  } catch (e) {
    console.error(`secret-check: ERROR: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  }
}
