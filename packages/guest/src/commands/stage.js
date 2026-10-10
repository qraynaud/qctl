import { createContext } from '../init/context.js'
import { StageError, UnknownStageError } from '../init/errors.js'
import { runStage } from '../init/run-stage.js'
import { ALL_STAGES, PROFILES } from '../init/stages.js'

/** @import { Argv } from 'yargs' */

export const command = 'stage <name>'
export const describe = 'Run a single init stage'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('name', {
      type: 'string',
      describe: `Stage name (${ALL_STAGES.join(' | ')})`,
    })
    .option('profile', {
      type: 'string',
      choices: PROFILES,
      default: 'default',
      describe: 'Init profile the stage is running under',
    })
    .option('dry-run', {
      type: 'boolean',
      default: false,
      describe: 'Print what would run; no side effects',
    })
}

/**
 * @typedef {object} StageArgv
 * @property {string} name
 * @property {string} [profile]
 * @property {boolean} [dryRun]
 */

/**
 * @param {StageArgv} argv
 */
export async function handler(argv) {
  const name = String(argv.name)
  const ctx = createContext({
    profile: /** @type {'default' | 'init-tank'} */ (argv.profile ?? 'default'),
    dryRun: Boolean(argv.dryRun),
  })
  try {
    await runStage(name, ctx)
  } catch (err) {
    if (err instanceof UnknownStageError) {
      console.error(err.message)
      console.error(`known: ${ALL_STAGES.join(', ')}`)
    } else if (err instanceof StageError) {
      console.error(`qctl: ${err.message}`)
    } else {
      console.error(`qctl: ${err instanceof Error ? err.message : String(err)}`)
    }
    process.exitCode = 1
  }
}
