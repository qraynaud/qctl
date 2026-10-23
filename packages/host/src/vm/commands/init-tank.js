import { chalk } from 'zx'

import { sharedBoot, sharedDryRun } from '../../lib/options.js'
import { loadDriver } from '../drivers/index.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'init-tank [poolIds..]'
export const describe = 'Create ZFS tanks once (Quickstart init can run this for you)'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedDryRun(sharedBoot(yargs))
    .positional('poolIds', {
      type: 'string',
      describe: 'Pool id(s) from disks.tanks (default: all tanks)',
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      default: false,
      describe: 'Recreate pool on selected tank members if they already exist',
    })
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
  const pools = argv.poolIds?.length ? argv.poolIds.join(',') : 'all tanks'
  console.log(
    chalk.cyan('vm init-tank'),
    chalk.dim(
      `target=${argv.target} env=${argv.env} name=${argv.name} pools=${pools}`
        + (argv.force ? ' force' : ''),
    ),
  )
  console.log(
    chalk.dim(
      '  disposable boot disk (keep disks.os); -f wipes tank members; guest zpool create→export→poweroff',
    ),
  )
  await driver.initTank(argv)
}
