import { registerCommands } from '@qctl/shared'

import * as app from './new/app.js'
import * as common from './new/common.js'
import * as network from './new/network.js'
import * as unit from './new/unit.js'
/** @import { Argv } from 'yargs' */

export const command = 'new'
export const describe =
  'Scaffold app / common / network / unit trees (app --engine → app.yaml + units)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return registerCommands(yargs, [app, common, network, unit]).demandCommand(1).strictCommands()
}

/** Parent-only; subcommands carry the work. */
export function handler() {}
