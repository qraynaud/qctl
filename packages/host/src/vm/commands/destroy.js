import { chalk } from 'zx'

import { sharedDryRun, sharedLibvirt } from '../../lib/options.js'
import { die } from '../../lib/util.js'
import { resolveDriver } from '../drivers/index.js'
import { confirmProdFullDestroy } from '../libs/confirm-destroy.js'
import { runVmDestroy } from '../libs/destroy-pipeline.js'
import { persistentDiskLabels } from '../libs/disk-plan.js'
import { resolveProvisionDisks } from '../libs/resolve-provision-disks.js'

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
  const { module, ctx } = await resolveDriver(argv)
  console.log(
    chalk.cyan('vm destroy'),
    chalk.dim(`target=${argv.target} env=${argv.env} name=${argv.name}`),
  )

  if (argv.yes && !argv.keepPersistent) {
    die('destroy: -y/--yes is only valid with --keep-persistent')
  }

  const fullWipe = !argv.keepPersistent
  if (fullWipe && argv.production && !argv.dryRun) {
    await confirmProdFullDestroy(argv.name)
  }

  /** @type {string[]} */
  let keepDisks = []
  if (argv.keepPersistent) {
    const resolved = await resolveProvisionDisks({
      env: argv.env || 'dev',
      target: String(module.id),
      profile: argv.profile,
    })
    keepDisks = persistentDiskLabels(resolved)
  }

  await runVmDestroy(ctx, { keepDisks, yes: argv.yes }, module)
}
