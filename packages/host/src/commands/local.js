import { registerCommands } from '@qctl/shared'

import { localCommands } from '../local/commands.js'
/** @import { Argv } from 'yargs' */

export const command = 'local'
export const describe = 'Podman lab without a VM (advanced)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return registerCommands(yargs, localCommands).demandCommand(1).strictCommands()
}

export function handler() {}
