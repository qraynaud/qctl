import {
  formatNewProfileOutro,
  resolveNewProfileOptions,
  scaffoldNewProfile,
} from '../../new/prompt.js'
/** @import { Argv } from 'yargs' */

export const command = 'profile [name]'
export const describe =
  'Add a VM profile (env + target; Proxmox section D overlays / API token when needed)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('name', {
      type: 'string',
      describe: 'Profile name (prompted on TTY if omitted)',
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing profile YAML / profiles entry / target layer',
    })
    .option('yes', {
      alias: 'y',
      type: 'boolean',
      default: false,
      describe: 'Non-interactive (name + --env required; --target defaults to proxmox)',
    })
    .option('env', {
      type: 'string',
      describe: 'Environment key from qctl.environments (required with --yes)',
    })
    .option('target', {
      type: 'string',
      describe: 'workstation | proxmox (--yes defaults to proxmox)',
    })
    .option('set-default', {
      type: 'boolean',
      describe: 'Set qctl.default-profile to this name (--yes defaults false)',
    })
    .option('skip-overlays', {
      type: 'boolean',
      default: false,
      describe: 'Do not prompt or rewrite target-*.yaml (stub only if missing)',
    })
}

/**
 * @typedef {object} NewProfileArgv
 * @property {string} [name]
 * @property {boolean} [force]
 * @property {boolean} [yes]
 * @property {string} [env]
 * @property {string} [target]
 * @property {boolean} [setDefault]
 * @property {boolean} [skipOverlays]
 */

/**
 * Shared entry used by `qctl new profile` and init “Add Proxmox”.
 * @param {NewProfileArgv & {
 *   preferTarget?: 'workstation' | 'proxmox'
 *   nameInitial?: string
 *   cwd?: string
 * }} argv
 */
export async function runNewProfile(argv) {
  const opts = await resolveNewProfileOptions(
    {
      name: argv.name,
      force: Boolean(argv.force),
      yes: Boolean(argv.yes),
      env: argv.env,
      target: argv.target,
      setDefault: argv.setDefault,
      skipOverlays: argv.skipOverlays,
    },
    {
      cwd: argv.cwd,
      preferTarget: argv.preferTarget,
      nameInitial: argv.nameInitial,
    },
  )
  const result = scaffoldNewProfile(opts, { cwd: argv.cwd })
  console.log(`created profile ${result.name} (env=${result.env}, target=${result.target})`)
  for (const rel of result.written) console.log(`  + ${rel}`)
  for (const rel of result.skipped) console.log(`  = ${rel} (exists)`)
  if (result.overlayWritten) {
    console.log(`  ~ provision/target-${result.target}.yaml (overlays)`)
  }
  console.log(formatNewProfileOutro(result.name, result.target))
  return result
}

/**
 * @param {NewProfileArgv} argv
 */
export async function handler(argv) {
  try {
    await runNewProfile(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
