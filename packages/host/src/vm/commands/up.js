import { chalk } from 'zx'

import { loadDriver } from '../drivers/index.js'
import { sharedBoot, sharedDryRun, sharedPasstPorts } from '../libs/options.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'up'
export const describe =
  'Start existing VM, or create if missing; stream console until ready (first boot / multi-user)'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedDryRun(sharedPasstPorts(sharedBoot(yargs)))
    .option('wipe-os', {
      type: 'boolean',
      default: false,
      describe: 'Undefine domain + recreate OS overlay (keep /vw + tank vdevs), then virt-install',
    })
    .option('force-download', {
      type: 'boolean',
      default: false,
      describe: 'Re-download cloud image even if cached',
    })
    .option('timeout', {
      type: 'number',
      default: 2700,
      describe: 'Seconds to wait for boot ready (default 45m)',
    })
    .option('no-console', {
      type: 'boolean',
      default: false,
      describe: 'Do not stream serial / wait for boot (exit after create/start)',
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
    chalk.cyan('vm up'),
    chalk.dim(`target=${argv.target} env=${argv.env} name=${argv.name}`),
  )
  await driver.up(argv)
}
