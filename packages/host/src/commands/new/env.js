import { syncSchemaFromProvisionYaml } from '../../init/wizard/secrets.js'
import { resolveNewEnvOptions } from '../../new/prompt.js'
import { newEnv } from '../../new/provision.js'
/** @import { Argv } from 'yargs' */

export const command = 'env [name]'
export const describe = 'Add a provision environment (common.yaml + env-*.yaml + .env.<name>)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('name', {
      type: 'string',
      describe: 'Environment name (prompted on TTY if omitted)',
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing env YAML / .env file / environments entry',
    })
    .option('yes', {
      alias: 'y',
      type: 'boolean',
      default: false,
      describe: 'Non-interactive (name required on CLI)',
    })
    .option('production', {
      type: 'boolean',
      describe: 'Set qctl.environments.<name>.production: true (--yes defaults false)',
    })
    .option('from', {
      type: 'string',
      describe: 'Copy provision/env-<from>.yaml as the starting content',
    })
    .option('sync-env-from-yaml', {
      type: 'boolean',
      describe: 'Add-only: ensure provision/.env.schema declares every !env ref',
    })
}

/**
 * @typedef {object} NewEnvArgv
 * @property {string} [name]
 * @property {boolean} [force]
 * @property {boolean} [yes]
 * @property {boolean} [production]
 * @property {string} [from]
 * @property {boolean} [syncEnvFromYaml]
 */

/**
 * @param {NewEnvArgv} argv
 */
export async function handler(argv) {
  try {
    const opts = await resolveNewEnvOptions({
      name: argv.name,
      force: Boolean(argv.force),
      yes: Boolean(argv.yes),
      production: argv.production,
      from: argv.from,
      syncEnvFromYaml: argv.syncEnvFromYaml,
    })
    const result = newEnv(opts.name, {
      force: opts.force,
      production: opts.production,
      from: opts.from,
    })
    console.log(`created environment ${result.name}`)
    for (const rel of result.written) console.log(`  + ${rel}`)
    for (const rel of result.skipped) console.log(`  = ${rel} (exists)`)

    if (opts.syncEnvFromYaml) {
      const { added } = syncSchemaFromProvisionYaml(result.root)
      if (added.length) console.log(`  schema + ${added.join(', ')}`)
      else console.log('  schema unchanged')
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
