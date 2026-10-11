import { chalk } from 'zx'

import { loadDriver } from '../drivers/index.js'
import { sharedBoot, sharedDryRun } from '../libs/options.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'init-tank'
export const describe =
  'One-shot VM: minimal seed creates+exports tank then poweroffs; host destroy --keep-data'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedDryRun(sharedBoot(yargs))
    .option('timeout', {
      type: 'number',
      default: 2700,
      describe: 'Seconds to wait for guest poweroff after virt-install (default 45m)',
    })
    .option('force-download', {
      type: 'boolean',
      default: false,
      describe: 'Re-download cloud image even if cached',
    })
    .option('no-console', {
      type: 'boolean',
      default: false,
      describe: 'Do not stream guest serial console to the host TTY',
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
    chalk.cyan('vm init-tank'),
    chalk.dim(`target=${argv.target} env=${argv.env} name=${argv.name}`),
  )
  console.log(
    chalk.dim(
      '  wipe OS + tank vdevs; keep /vw; guest: create→export→poweroff; host: destroy --keep-data',
    ),
  )
  await driver.initTank(argv)
}
