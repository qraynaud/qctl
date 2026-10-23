import { chalk } from 'zx'

import { sharedLibvirt } from '../../lib/options.js'
import { resolveProfileArgv } from '../../lib/profile-argv.js'
import { resolveSyncEndpoint } from '../../sync/endpoint.js'
import { sshInteractiveShell } from '../../sync/ssh.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'shell'
export const describe = 'Open an SSH shell into the VM'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedLibvirt(yargs)
    .option('network', {
      choices: ['auto', 'default', 'user'],
      default: 'user',
      describe: 'How to reach the guest (user/auto: passt forward; default: DHCP lease)',
    })
    .option('user', {
      type: 'string',
      default: 'rocky',
      describe: 'SSH user (appliance admin)',
    })
    .option('host', {
      type: 'string',
      describe: 'SSH host override (required for proxmox profiles)',
    })
    .option('port', {
      type: 'number',
      describe: 'SSH port override (default: passt forward or 22)',
    })
    .option('identity', {
      type: 'string',
      describe: 'SSH private key path (default: ~/.ssh/id_* or ssh-agent)',
    })
    .strict()
}

/**
 * @param {VmArgv & {
 *   user?: string
 *   host?: string
 *   port?: number
 *   identity?: string
 * }} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  try {
    resolveProfileArgv(argv)
    const ep = await resolveSyncEndpoint(argv)
    console.log(
      chalk.cyan('vm shell'),
      chalk.dim(
        `profile=${argv.profile ?? '(default)'} target=${argv.target} env=${argv.env} `
          + `${ep.username}@${ep.host}:${ep.port}`,
      ),
    )

    const code = await sshInteractiveShell({
      host: ep.host,
      port: ep.port,
      username: ep.username,
      identity: ep.identity,
    })
    if (code !== 0) process.exitCode = code
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
