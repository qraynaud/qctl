import { registerCommands } from '@qctl/shared'

import * as ensure from './plugins/ensure.js'

/** @import { Argv } from 'yargs' */

export const command = 'plugins'
export const describe = 'Ensure varlock third-party plugins are in the local plugins-cache'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return registerCommands(yargs, [ensure]).demandCommand(1).strictCommands()
}

export function handler() {}
