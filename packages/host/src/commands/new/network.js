import { resolveNewNamedPackageOptions } from '../../new/prompt.js'
import { newPackage } from '../../new.js'
/** @import { Argv } from 'yargs' */

export const command = 'network [name]'
export const describe = 'Create networks/<name>/ (+ commented .network stub)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('name', {
      type: 'string',
      describe: 'Network name (prompted on TTY if omitted)',
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
      describe: 'Non-interactive (name required on CLI)',
    })
    .option('empty', {
      type: 'boolean',
      default: false,
      describe: 'Skip <name>.network Quadlet stub',
    })
}

/**
 * @typedef {object} NewNetworkArgv
 * @property {string} [name]
 * @property {boolean} [force]
 * @property {boolean} [yes]
 * @property {boolean} [empty]
 */

/**
 * @param {NewNetworkArgv} argv
 */
export async function handler(argv) {
  try {
    const opts = await resolveNewNamedPackageOptions(
      { name: argv.name, force: Boolean(argv.force), yes: Boolean(argv.yes) },
      { kind: 'network' },
    )
    const result = newPackage('network', opts.name, {
      force: opts.force,
      networkStub: !argv.empty,
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
