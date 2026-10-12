import { chalk } from 'zx'

import { sharedLibvirt } from '../../lib/options.js'
import { die } from '../../lib/util.js'
import { loadDriver } from '../drivers/index.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'target-check'
export const describe = 'Verify host tools / secrets / hypervisor config for the selected --target'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedLibvirt(yargs).strict()
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const driver = await loadDriver(argv)
  if (typeof driver.check !== 'function') {
    die(`target-check not implemented for --target ${argv.target}`)
  }
  console.log(chalk.cyan('vm target-check'), chalk.dim(`target=${argv.target} env=${argv.env}`))
  await driver.check(argv)
}
