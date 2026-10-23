import { sharedProfile } from '../../lib/options.js'
import { resolveProfileArgv } from '../../lib/profile-argv.js'
import { runSeed } from '../libs/seed/run.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'seed'
export const describe = 'Build the cloud-init seed ISO (usually automatic via bare vm up)'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedProfile(yargs)
    .option('seed-profile', {
      choices: ['appliance', 'init-tank'],
      default: 'appliance',
      describe: 'Seed ISO kind: appliance = full first-boot; init-tank = minimal tank-create',
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
  resolveProfileArgv(argv)
  await runSeed(argv)
}
