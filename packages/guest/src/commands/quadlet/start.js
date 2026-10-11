import { runQuadletCommand, withRootOption } from '../../quadlet/cli.js'
import { runStartStop } from '../../quadlet/lifecycle.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'start <app>'
export const describe = "Start one app's units (systemctl start)"

/** @param {Argv} yargs */
export function builder(yargs) {
  return withRootOption(yargs).positional('app', { type: 'string', demandOption: true })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  await runQuadletCommand(argv, (ctx) => runStartStop(ctx, 'start', String(argv.app)))
}
