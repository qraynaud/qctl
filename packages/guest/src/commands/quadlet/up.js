import { argvApps, runQuadletCommand } from '../../quadlet/cli.js'
import { runUp } from '../../quadlet/up/index.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletArgv } from '../../quadlet/cli.js' */

export const command = 'up [apps..]'
export const describe = 'Reconcile apps with the repo (compose up–ish)'

/** @param {Argv} yargs */
export function builder(yargs) {
  return yargs
    .positional('apps', {
      type: 'string',
      array: true,
      describe: 'Only these apps (plus companions); omit = all',
    })
    .option('dry-run', {
      alias: 'n',
      type: 'boolean',
      default: false,
      describe: 'Print will add|update|remove|restart lines; change nothing',
    })
}

/** @param {QuadletArgv} argv */
export async function handler(argv) {
  const apps = argvApps(argv)
  await runQuadletCommand((ctx) =>
    runUp(ctx, {
      dryRun: Boolean(argv.dryRun),
      apps: apps.length ? apps : undefined,
    }),
  )
}
