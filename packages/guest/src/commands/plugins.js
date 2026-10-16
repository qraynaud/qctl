import { registerCommands } from '@qctl/shared'

import * as ensure from './plugins/ensure.js'

/** @import { Argv } from 'yargs' */

export const command = 'plugins'
export const describe = 'Ensure instance package.json plugins are installed into node_modules'
/** Hidden from default `qctl -h` (shown with `--help-with-internals`). */
export const internal = true

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return registerCommands(yargs, [ensure]).demandCommand(1).strictCommands()
}

export function handler() {}
