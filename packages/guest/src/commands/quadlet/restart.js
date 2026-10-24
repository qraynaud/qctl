import { argvApps, runQuadletCommand } from '../../quadlet/cli.js'
import { runRestart } from '../../quadlet/lifecycle.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'restart <apps..>'
export const describe = "Restart apps' units (blocks on Notify=healthy)"

/** @param {Argv} yargs */
export function builder(yargs) {
  return yargs.positional('apps', {
    type: 'string',
    array: true,
    demandOption: true,
    describe: 'Apps to restart',
  })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  const apps = argvApps(argv)
  await runQuadletCommand((ctx) => {
    for (const app of apps) runRestart(ctx, app)
  })
}
