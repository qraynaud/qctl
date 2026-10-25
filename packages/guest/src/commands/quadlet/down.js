import { argvApps, callQuadlet } from './rpc.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from './rpc.js' */

export const command = 'down <apps..>'
export const describe = 'Stop and unregister apps (data stays)'

/** @param {Argv} yargs */
export function builder(yargs) {
  return yargs.positional('apps', {
    type: 'string',
    array: true,
    demandOption: true,
    describe: 'Apps to stop and unregister',
  })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  await callQuadlet({ op: 'down', apps: argvApps(argv) })
}
