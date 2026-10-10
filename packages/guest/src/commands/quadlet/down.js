import { runQuadletCommand, withRootOption } from '../../quadlet/cli.js'
import { runDown } from '../../quadlet/lifecycle.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'down <app>'
export const describe = 'Stop and unregister one app (data stays)'

/** @param {Argv} yargs */
export function builder(yargs) {
  return withRootOption(yargs).positional('app', { type: 'string', demandOption: true })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  await runQuadletCommand(argv, (ctx) => runDown(ctx, String(argv.app)))
}
