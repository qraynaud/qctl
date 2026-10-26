import { chalk } from 'zx'

import { sharedLibvirt } from '../../lib/options.js'
import { resolveDriver } from '../drivers/index.js'
import { runVmStatus } from '../libs/status-pipeline.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'status'
export const describe = 'Show VM status + SSH hints'

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
  const { module, ctx } = await resolveDriver(argv)
  console.log(
    chalk.cyan('vm status'),
    chalk.dim(`target=${argv.target} env=${argv.env} name=${argv.name}`),
  )
  await runVmStatus(ctx, module)
}
