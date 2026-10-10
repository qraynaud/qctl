import { loadDriver } from '../drivers/index.js'
import { addPasstPortOptions, portsFromArgv, sharedLibvirt } from '../libs/options.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'ssh-info'
export const describe = 'Print SSH connection hints'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return addPasstPortOptions(
    sharedLibvirt(yargs).option('network', {
      choices: ['auto', 'default', 'user'],
      default: 'user',
      describe: 'Network mode used when the VM was created',
    }),
    (() => {
      try {
        return portsFromArgv({})
      } catch {
        return []
      }
    })(),
  ).strict()
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const driver = await loadDriver(argv)
  await driver.sshInfo(argv)
}
