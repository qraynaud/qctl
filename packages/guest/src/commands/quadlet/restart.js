import { argvApps, callQuadlet } from './rpc.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from './rpc.js' */

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
  await callQuadlet({ op: 'restart', apps: argvApps(argv) })
}
