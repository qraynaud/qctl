import { argvApps, callQuadlet } from './rpc.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from './rpc.js' */

export const command = 'enable <apps..>'
export const describe = "Render/install apps' units"

/** @param {Argv} yargs */
export function builder(yargs) {
  return yargs
    .positional('apps', {
      type: 'string',
      array: true,
      demandOption: true,
      describe: 'Apps to enable',
    })
    .option('install', {
      type: 'boolean',
      default: true,
      describe: 'Write the autostart drop-in (--no-install to skip)',
    })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  await callQuadlet({
    op: 'enable',
    apps: argvApps(argv),
    install: argv.install !== false,
  })
}
