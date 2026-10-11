import { runQuadletCommand, withRootOption } from '../../quadlet/cli.js'
import { runRestart } from '../../quadlet/lifecycle.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'restart <app>'
export const describe = "Restart one app's units (blocks on Notify=healthy)"

/** @param {Argv} yargs */
export function builder(yargs) {
  return withRootOption(yargs).positional('app', { type: 'string', demandOption: true })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  await runQuadletCommand(argv, (ctx) => runRestart(ctx, String(argv.app)))
}
