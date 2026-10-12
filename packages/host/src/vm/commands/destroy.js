import { chalk } from 'zx'

import { sharedDryRun, sharedLibvirt } from '../../lib/options.js'
import { loadDriver } from '../drivers/index.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'destroy'
export const describe = 'Undefine / delete VM; delete disks unless --keep-data'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedDryRun(sharedLibvirt(yargs))
    .option('keep-data', {
      type: 'boolean',
      default: false,
      describe: 'Remove OS only; keep /vw + data + special disks',
    })
    .strict()
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const driver = await loadDriver(argv)
  console.log(
    chalk.cyan('vm destroy'),
    chalk.dim(`target=${argv.target} env=${argv.env} name=${argv.name}`),
  )
  await driver.destroy(argv)
}
