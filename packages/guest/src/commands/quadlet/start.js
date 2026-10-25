import { argvApps, callQuadlet } from './rpc.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from './rpc.js' */

export const command = 'start <apps..>'
export const describe = "Start apps' units (systemctl start)"

/** @param {Argv} yargs */
export function builder(yargs) {
  return yargs.positional('apps', {
    type: 'string',
    array: true,
    demandOption: true,
    describe: 'Apps to start',
  })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  await callQuadlet({ op: 'start', apps: argvApps(argv) })
}
