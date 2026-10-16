import { ALL_STAGES, PROFILES, stagesForProfile } from '../init/stages.js'

/** @import { Argv } from 'yargs' */

export const command = '_internal_list'
export const describe = 'List init stages in order (one per line)'
/** Hidden from default `qctl -h` (shown with `--help-with-internals`). */
export const internal = true

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .option('profile', {
      type: 'string',
      choices: PROFILES,
      default: 'default',
      describe: 'Init profile',
    })
    .option('all', {
      type: 'boolean',
      default: false,
      describe: 'List every runnable stage across profiles',
    })
}

/**
 * @typedef {object} ListArgv
 * @property {string} [profile]
 * @property {boolean} [all]
 */

/**
 * @param {ListArgv} argv
 */
export async function handler(argv) {
  const stages = argv.all ? ALL_STAGES : stagesForProfile(String(argv.profile ?? 'default'))
  for (const stage of stages) {
    console.log(stage)
  }
}
