import { resolveNewAppOptions, scaffoldAppUnits } from '../../new/prompt.js'
import { newPackage } from '../../new.js'
/** @import { Argv } from 'yargs' */

export const command = 'app [name]'
export const describe = 'Create applications/<name>/ (optional app.yaml + units via new unit)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('name', {
      type: 'string',
      describe: 'App name (prompted on TTY if omitted)',
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing scaffold files',
    })
    .option('yes', {
      alias: 'y',
      type: 'boolean',
      default: false,
      describe: 'Non-interactive: require name; default engine=rootless + first demo unit',
    })
    .option('engine', {
      type: 'string',
      choices: ['rootless', 'rootful'],
      describe: 'Write app.yaml with this Podman engine',
    })
    .option('empty', {
      type: 'boolean',
      default: false,
      describe: 'Skip units (app.yaml still written when --engine / --yes)',
    })
    .option('unit', {
      type: 'string',
      describe: 'First unit directory name (default: app name)',
    })
}

/**
 * @typedef {object} NewAppArgv
 * @property {string} [name]
 * @property {boolean} [force]
 * @property {boolean} [yes]
 * @property {string} [engine]
 * @property {boolean} [empty]
 * @property {string} [unit]
 */

/**
 * @param {NewAppArgv} argv
 */
export async function handler(argv) {
  try {
    const opts = await resolveNewAppOptions({
      name: argv.name,
      force: Boolean(argv.force),
      yes: Boolean(argv.yes),
      engine: argv.engine,
      empty: Boolean(argv.empty),
      unit: argv.unit,
    })
    const result = newPackage('app', opts.name, {
      force: opts.force,
      engine: opts.engine,
    })
    console.log(`created ${result.path}`)
    for (const rel of result.extra) {
      console.log(`  + ${rel}`)
    }

    const unitExtras = await scaffoldAppUnits(opts.name, opts, {})
    for (const rel of unitExtras) {
      console.log(`  + ${rel}`)
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
