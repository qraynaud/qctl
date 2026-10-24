import { argvApps, runQuadletCommand } from '../../quadlet/cli.js'
import { runEnable } from '../../quadlet/enable.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

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
  const apps = argvApps(argv)
  await runQuadletCommand(async (ctx) => {
    for (const app of apps) {
      await runEnable(ctx, { app, install: argv.install !== false })
    }
  })
}
