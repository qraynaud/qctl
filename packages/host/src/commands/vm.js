import { registerCommands } from '@qctl/shared'

import { vmCommands } from '../vm/commands/index.js'
/** @import { Argv } from 'yargs' */

export const command = 'vm'
export const describe = 'Create and manage the appliance VM (workstation or Proxmox)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return registerCommands(yargs, vmCommands)
    .demandCommand(1)
    .strictCommands()
    .epilog(
      [
        'App lifecycle (like qctl local, on the appliance VM):',
        '  qctl vm up [apps…]|--all   # ensure VM up, then guest quadlet up',
        '  qctl vm down [apps…]|--all # guest quadlet down only (VM stays up)',
        '  qctl vm ps [apps…]         # VM power + guest quadlet ps',
        '  qctl vm shell              # interactive SSH',
        'Bare `vm down` ACPI-shuts the whole VM. init-tank is usually offered by qctl init.',
      ].join('\n'),
    )
}

export function handler() {}
