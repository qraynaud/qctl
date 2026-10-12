import { chalk } from 'zx'

import { sharedDryRun, sharedLibvirt } from '../../lib/options.js'
import { loadDriver } from '../drivers/index.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'down'
export const describe =
  'ACPI shutdown the VM and wait until shut off (VM stays defined; up restarts it)'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedDryRun(sharedLibvirt(yargs))
    .option('timeout', {
      type: 'number',
      default: 120,
      describe: 'Seconds to wait for shut off after ACPI shutdown',
    })
    .option('force', {
      type: 'boolean',
      default: false,
      describe: 'Force poweroff if still running after timeout',
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
    chalk.cyan('vm down'),
    chalk.dim(`target=${argv.target} env=${argv.env} name=${argv.name}`),
  )
  await driver.down(argv)
}
