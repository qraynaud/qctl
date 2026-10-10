import { runQuadletCommand, withRootOption } from '../../quadlet/cli.js'
import { runUp } from '../../quadlet/up.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'up [app]'
export const describe = 'Reconcile apps with the repo (compose up–ish)'

/** @param {Argv} yargs */
export function builder(yargs) {
  return withRootOption(yargs)
    .positional('app', { type: 'string', describe: 'Only this app (plus companions)' })
    .option('dry-run', {
      alias: 'n',
      type: 'boolean',
      default: false,
      describe: 'Print will add|update|remove|restart lines; change nothing',
    })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  await runQuadletCommand(argv, (ctx) =>
    runUp(ctx, {
      dryRun: Boolean(argv.dryRun),
      app: typeof argv.app === 'string' ? argv.app : undefined,
    }),
  )
}
