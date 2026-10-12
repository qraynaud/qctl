import { applianceRunning, ensureAppliance } from './appliance.js'
import { createLocalContext } from './context.js'
import { shellInAppliance } from './exec-in.js'
import { sharedLocalEnv } from './options.js'
import { die } from './util.js'

/** @import { Argv } from 'yargs' */

export const command = 'shell'
export const describe = 'Interactive shell in the nested appliance'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedLocalEnv(yargs)
    .option('no-ensure', {
      type: 'boolean',
      default: false,
      describe: 'Fail if the appliance is not already running',
    })
    .strict()
}

/**
 * @typedef {object} LocalShellArgv
 * @property {string} [env]
 * @property {boolean} [noEnsure]
 */

/**
 * @param {LocalShellArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const ctx = await createLocalContext(argv)
  if (argv.noEnsure) {
    if (!(await applianceRunning(ctx))) {
      die(`appliance ${ctx.name} is not running`)
    }
  } else {
    await ensureAppliance(ctx)
  }
  const code = await shellInAppliance(ctx)
  if (code !== 0) process.exit(code)
}
