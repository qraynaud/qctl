import { argvApps, callQuadlet } from './rpc.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from './rpc.js' */

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
  await callQuadlet({
    op: 'ps',
    ...(apps.length ? { apps } : {}),
  })
}
