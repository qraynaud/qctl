import { chalk } from 'zx'

import { sharedLibvirt } from '../../lib/options.js'
import { resolveDriver } from '../drivers/index.js'
import { runVmCheck } from '../libs/check-pipeline.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'target-check'
export const describe = 'Check that this host can run the VM (tools + provision)'

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
  console.log(chalk.cyan('vm target-check'), chalk.dim(`target=${argv.target} env=${argv.env}`))
  await runVmCheck(ctx, module)
}
