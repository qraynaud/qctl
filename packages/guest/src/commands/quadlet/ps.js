import { runQuadletCommand, withRootOption } from '../../quadlet/cli.js'
import { runPs } from '../../quadlet/lifecycle.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'ps [app]'
export const describe = 'Installed containers (both engines, or one app)'

/** @param {Argv} yargs */
export function builder(yargs) {
  return withRootOption(yargs).positional('app', { type: 'string' })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  await runQuadletCommand(argv, (ctx) =>
    runPs(ctx, typeof argv.app === 'string' ? argv.app : undefined),
  )
}
