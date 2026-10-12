import { argvApps, runQuadletCommand, withRootOption } from '../../quadlet/cli.js'
import { runDown } from '../../quadlet/lifecycle.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'down <apps..>'
export const describe = 'Stop and unregister apps (data stays)'

/** @param {Argv} yargs */
export function builder(yargs) {
  return withRootOption(yargs).positional('apps', {
    type: 'string',
    array: true,
    demandOption: true,
    describe: 'Apps to stop and unregister',
  })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  const apps = argvApps(argv)
  await runQuadletCommand(argv, (ctx) => {
    for (const app of apps) runDown(ctx, app)
  })
}
