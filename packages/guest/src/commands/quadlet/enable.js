import { runQuadletCommand, withRootOption } from '../../quadlet/cli.js'
import { runEnable } from '../../quadlet/enable.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'enable <app>'
export const describe = "Render/install one app's units"

/** @param {Argv} yargs */
export function builder(yargs) {
  return withRootOption(yargs)
    .positional('app', { type: 'string', demandOption: true })
    .option('install', {
      type: 'boolean',
      default: true,
      describe: 'Write the autostart drop-in (--no-install to skip)',
    })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  await runQuadletCommand(argv, (ctx) =>
    runEnable(ctx, { app: String(argv.app), install: argv.install !== false }),
  )
}
