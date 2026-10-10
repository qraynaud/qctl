import { sharedTarget } from '../libs/options.js'
import { runSeed } from '../libs/seed.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'seed'
export const describe =
  'Build NoCloud seed ISO (or FAT img) for --env / --target (provision/<env>.yaml + optional overlay)'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedTarget(yargs)
    .option('profile', {
      choices: ['appliance', 'init-tank'],
      default: 'appliance',
      describe: 'appliance = full first-boot; init-tank = minimal tank-create seed',
    })
    .option('out', {
      type: 'string',
      describe: 'Keep unpacked cidata tree at this path (debug; default: stage in tmp only)',
    })
    .option('instance-id', {
      type: 'string',
      describe:
        'cloud-init instance-id (default: reuse previous seed, else rocky-<env>; '
        + 'set a new value to force a full cloud-init run)',
    })
    .option('allow-missing-tier0', {
      type: 'boolean',
      default: false,
      describe: 'Allow omitting Tier-0 @tag(guest) VW_* keys when absent',
    })
    .option('allow-missing-files', {
      type: 'boolean',
      default: false,
      describe: 'Stub missing !file paths instead of failing',
    })
    .strict()
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  await runSeed(argv)
}
