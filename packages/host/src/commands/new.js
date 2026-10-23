import { registerCommands } from '@qctl/shared'

import * as app from './new/app.js'
import * as common from './new/common.js'
import * as env from './new/env.js'
import * as network from './new/network.js'
import * as profile from './new/profile.js'
import * as unit from './new/unit.js'
/** @import { Argv } from 'yargs' */

export const command = 'new'
export const describe =
  'Scaffold app / common / network / unit / env / profile (app --engine → app.yaml + units)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return registerCommands(yargs, [app, common, network, unit, env, profile])
    .demandCommand(1)
    .strictCommands()
    .epilog('Profile (e.g. Proxmox): qctl new profile [name] — keep lab; do not --force init.')
}

/** Parent-only; subcommands carry the work. */
export function handler() {}
