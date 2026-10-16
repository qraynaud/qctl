/**
 * CLI provision-profile selection → internal env / target / production.
 */
import { resolveProfile } from '@qctl/shared'

import { tryGetRepoRoot } from './paths.js'
import { die } from './util.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../vm/types.js' */

/**
 * Register `--profile` (provision profile key from `qctl.profiles`).
 * @param {Argv} y
 * @returns {Argv}
 */
export function sharedProfile(y) {
  return y.option('profile', {
    alias: 'p',
    type: 'string',
    describe: 'Provision profile key from qctl.profiles (common.yaml)',
  })
}

/**
 * Resolve profile into argv.env / argv.target / argv.production / argv.profile.
 * Sets `process.env.QCTL_ENV` from the profile env (profile is SoT for the command).
 * Idempotent when `_qctlProfileResolved` is already set.
 *
 * @param {Partial<VmArgv> & { profile?: string | null }} argv
 * @param {{
 *   root?: string | null,
 *   requireLocal?: boolean,
 * }} [opts]
 * @returns {typeof argv}
 */
export function resolveProfileArgv(argv, opts = {}) {
  if (argv._qctlProfileResolved) return argv

  const root = opts.root !== undefined ? opts.root : tryGetRepoRoot()
  if (!root) {
    die(
      `not inside a qctl instance repo `
        + `(no provision/*.yaml with a qctl: block above ${process.cwd()})\n`
        + '  Run `qctl init <dir>` to scaffold one, or cd into an existing instance.',
    )
  }

  /** @type {string | null | undefined} */
  const requested = argv.profile
  let resolved
  try {
    resolved = resolveProfile({ root, profile: requested })
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }

  if (opts.requireLocal && resolved.target !== 'local') {
    die(
      `profile ${JSON.stringify(resolved.key)} has target ${resolved.target}; `
        + '`qctl local` requires a profile with target: local',
    )
  }

  argv.profile = resolved.key
  argv.env = resolved.env
  argv.target = resolved.target
  argv.production = resolved.production
  argv._qctlProfileResolved = true
  process.env.QCTL_ENV = resolved.env
  return argv
}
