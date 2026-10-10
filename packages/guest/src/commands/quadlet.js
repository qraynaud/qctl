import { registerCommands } from '@qctl/shared'

import * as down from './quadlet/down.js'
import * as enable from './quadlet/enable.js'
import * as ps from './quadlet/ps.js'
import * as restart from './quadlet/restart.js'
import * as start from './quadlet/start.js'
import * as stop from './quadlet/stop.js'
import * as up from './quadlet/up.js'
/** @import { Argv } from 'yargs' */

export const command = 'quadlet'
export const describe = 'Generate and manage Quadlet units from instance schemas'

const quadletCommands = [up, down, enable, start, stop, restart, ps]

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return registerCommands(yargs, quadletCommands).demandCommand(1).strictCommands()
}

export function handler() {}
