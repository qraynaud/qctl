import { registerCommands } from '@qctl/shared'

import * as check from './secret/check.js'
import * as sync from './secret/sync.js'
/** @import { Argv } from 'yargs' */

export const command = 'secret'
export const describe = 'Check / sync @sensitive schema values to Podman secrets'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return registerCommands(yargs, [check, sync]).demandCommand(1).strictCommands()
}

export function handler() {}
