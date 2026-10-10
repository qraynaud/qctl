import { registerCommands } from '@qctl/shared'

import { vmCommands } from '../vm/commands/index.js'
/** @import { Argv } from 'yargs' */

export const command = 'vm'
export const describe = 'Appliance VM lifecycle (seed, up, init-tank, …) from provision/*.yaml'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return registerCommands(yargs, vmCommands).demandCommand(1).strictCommands()
}

export function handler() {}
