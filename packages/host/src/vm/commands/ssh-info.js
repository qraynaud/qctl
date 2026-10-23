import { sharedLibvirt } from '../../lib/options.js'
import { loadDriver } from '../drivers/index.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'ssh-info'
export const describe = 'Show SSH host/port for the VM'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedLibvirt(yargs)
    .option('network', {
      choices: ['auto', 'default', 'user'],
      default: 'user',
      describe: 'Network mode used when the VM was created',
    })
    .strict()
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const driver = await loadDriver(argv)
  await driver.sshInfo(argv)
}
