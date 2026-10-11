import { registerCommands } from '@qctl/shared'

import * as app from './new/app.js'
import * as common from './new/common.js'
import * as network from './new/network.js'
/** @import { Argv } from 'yargs' */

export const command = 'new'
export const describe = 'Scaffold app / common / network trees'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return registerCommands(yargs, [app, common, network]).demandCommand(1).strictCommands()
}

/** Parent-only; subcommands carry the work. */
export function handler() {}
