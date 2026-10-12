import { argvApps, runQuadletCommand, withRootOption } from '../../quadlet/cli.js'
import { runStartStop } from '../../quadlet/lifecycle.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'stop <apps..>'
export const describe = "Stop apps' units (systemctl stop)"

/** @param {Argv} yargs */
export function builder(yargs) {
  return withRootOption(yargs).positional('apps', {
    type: 'string',
    array: true,
    demandOption: true,
    describe: 'Apps to stop',
  })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  const apps = argvApps(argv)
  await runQuadletCommand(argv, (ctx) => {
    for (const app of apps) runStartStop(ctx, 'stop', app)
  })
}
