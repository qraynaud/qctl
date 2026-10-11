import { runQuadletCommand, withRootOption } from '../../quadlet/cli.js'
import { runStartStop } from '../../quadlet/lifecycle.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'stop <app>'
export const describe = "Stop one app's units (systemctl stop)"

/** @param {Argv} yargs */
export function builder(yargs) {
  return withRootOption(yargs).positional('app', { type: 'string', demandOption: true })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  await runQuadletCommand(argv, (ctx) => runStartStop(ctx, 'stop', String(argv.app)))
}
