import { argvApps, callQuadlet } from './rpc.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from './rpc.js' */

export const command = 'stop <apps..>'
export const describe = "Stop apps' units (systemctl stop)"

/** @param {Argv} yargs */
export function builder(yargs) {
  return yargs.positional('apps', {
    type: 'string',
    array: true,
    demandOption: true,
    describe: 'Apps to stop',
  })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  await callQuadlet({ op: 'stop', apps: argvApps(argv) })
}
