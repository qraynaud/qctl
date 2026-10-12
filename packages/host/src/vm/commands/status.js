import { chalk } from 'zx'

import { addPasstPortOptions, portsFromArgv, sharedLibvirt } from '../../lib/options.js'
import { loadDriver } from '../drivers/index.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'status'
export const describe = 'Show VM status + SSH hints'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return addPasstPortOptions(
    sharedLibvirt(yargs).option('network', {
      choices: ['auto', 'default', 'user'],
      default: 'user',
      describe: 'Network mode used when the VM was created',
    }),
    (() => {
      try {
        return portsFromArgv({})
      } catch {
        return []
      }
    })(),
  ).strict()
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const driver = await loadDriver(argv)
  console.log(
    chalk.cyan('vm status'),
    chalk.dim(`target=${argv.target} env=${argv.env} name=${argv.name}`),
  )
  await driver.status(argv)
}
