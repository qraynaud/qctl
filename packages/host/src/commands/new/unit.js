import { resolveNewUnitOptions } from '../../new/prompt.js'
import { newUnit } from '../../new.js'
/** @import { Argv } from 'yargs' */

export const command = 'unit [app] [name]'
export const describe = 'Create applications/<app>/<name>/ unit scaffold'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('app', {
      type: 'string',
      describe: 'App name (select on TTY if omitted)',
    })
    .positional('name', {
      type: 'string',
      describe: 'Unit name (prompted on TTY if omitted)',
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing unit scaffold files',
    })
    .option('yes', {
      alias: 'y',
      type: 'boolean',
      default: false,
      describe: 'Non-interactive (app + name required on CLI)',
    })
    .option('empty', {
      type: 'boolean',
      default: false,
      describe: 'Skip .container file',
    })
    .option('env-stub', {
      type: 'boolean',
      default: false,
      describe: 'Write empty .env.dev beside the unit schema',
    })
}

/**
 * @typedef {object} NewUnitArgv
 * @property {string} [app]
 * @property {string} [name]
 * @property {boolean} [force]
 * @property {boolean} [yes]
 * @property {boolean} [empty]
 * @property {boolean} [envStub]
 */

/**
 * @param {NewUnitArgv} argv
 */
export async function handler(argv) {
  try {
    const opts = await resolveNewUnitOptions({
      app: argv.app,
      name: argv.name,
      force: Boolean(argv.force),
      yes: Boolean(argv.yes),
      empty: Boolean(argv.empty),
      envStub: Boolean(argv.envStub),
    })
    const result = newUnit(opts.app, opts.name, {
      force: opts.force,
      container: opts.container,
      envStub: opts.envStub,
    })
    console.log(`created ${result.path}`)
    for (const rel of result.extra) {
      console.log(`  + ${rel}`)
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
