import { ENVS } from '../lib/target.js'

/** @import { Argv } from 'yargs' */

/**
 * Shared `--env` for `qctl local` subcommands.
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function sharedLocalEnv(yargs) {
  return yargs.option('env', {
    choices: /** @type {string[]} */ ([...ENVS]),
    default: 'dev',
    describe: 'Instance env (QCTL_ENV / provision/<env>.yaml ports)',
  })
}
