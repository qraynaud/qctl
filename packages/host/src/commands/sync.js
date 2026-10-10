import { runSync } from '../sync/run.js'
import { sharedDryRun, sharedLibvirt } from '../vm/libs/options.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../vm/types.js' */

export const command = 'sync'
export const describe =
  'Push the instance repo to the appliance over SSH (ssh2); optional guest tooling refresh'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  // SSH forward comes from provision networking.ports (endpoint.js) — do not
  // re-export every passt --*-port flag (those belong on vm up / ssh-info).
  return sharedDryRun(
    sharedLibvirt(yargs)
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
        describe: 'SSH host override (required for --target proxmox)',
      })
      .option('port', {
        type: 'number',
        describe: 'SSH port override (default: passt forward or 22)',
      })
      .option('remote-dir', {
        type: 'string',
        default: '/tank/rocky',
        describe: 'Guest instance repo path',
      })
      .option('identity', {
        type: 'string',
        describe: 'SSH private key path (default: ~/.ssh/id_ed25519|id_rsa or ssh-agent)',
      })
      .option('include-tooling', {
        type: 'boolean',
        default: false,
        describe:
          'Also install compiled qctl-guest → /usr/local/bin/qctl and '
          + 'qctl-platform-rocky.mjs → /usr/local/lib/qctl/ '
          + '(+ varlock-local-encrypt / bootstrap when present)',
      })
      .option('delete', {
        type: 'boolean',
        default: true,
        describe:
          'Remove guest files absent from this checkout (keeps excluded paths: .hg, .env, …)',
      })
      .strict(),
  )
}

/**
 * @param {VmArgv & {
 *   user?: string
 *   host?: string
 *   port?: number
 *   remoteDir?: string
 *   identity?: string
 *   includeTooling?: boolean
 *   delete?: boolean
 * }} argv
 */
export async function handler(argv) {
  await runSync(argv)
}
