import { argvApps, runQuadletCommand } from '../../quadlet/cli.js'
import { runPs } from '../../quadlet/lifecycle.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'ps [apps..]'
export const describe = 'Installed containers (both engines, or listed apps)'

/** @param {Argv} yargs */
export function builder(yargs) {
  return yargs.positional('apps', {
    type: 'string',
    array: true,
    describe: 'Limit to these apps (omit = all installed)',
  })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  const apps = argvApps(argv)
  await runQuadletCommand((ctx) => runPs(ctx, apps.length ? apps : undefined))
}
