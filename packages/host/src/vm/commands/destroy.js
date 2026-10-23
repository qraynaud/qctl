import { chalk } from 'zx'

import { sharedDryRun, sharedLibvirt } from '../../lib/options.js'
import { die } from '../../lib/util.js'
import { loadDriver } from '../drivers/index.js'
import { confirmProdFullDestroy } from '../libs/confirm-destroy.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'destroy'
export const describe = 'Delete the VM (and disks unless --keep-persistent)'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedDryRun(sharedLibvirt(yargs))
    .option('keep-persistent', {
      type: 'boolean',
      default: false,
      describe: 'Remove OS only; keep data volumes + tank members',
    })
    .option('yes', {
      alias: 'y',
      type: 'boolean',
      default: false,
      describe: 'Skip prompts (only valid with --keep-persistent)',
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

  if (argv.yes && !argv.keepPersistent) {
    die('destroy: -y/--yes is only valid with --keep-persistent')
  }

  const fullWipe = !argv.keepPersistent
  if (fullWipe && argv.production && !argv.dryRun) {
    // Always interactive on production full wipe (-y cannot skip).
    await confirmProdFullDestroy(argv.name)
  }

  await driver.destroy(argv)
}
