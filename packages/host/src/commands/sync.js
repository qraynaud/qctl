import { sharedDryRun, sharedLibvirt } from '../lib/options.js'
import { runSync } from '../sync/run.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../vm/types.js' */

export const command = 'sync'
export const describe =
  'Push this repo over SSH (waits until the profile VM is reachable; optional tooling refresh)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  // SSH forward comes from provision networking.ports (endpoint.js) — do not
  // re-export every passt --*-port flag (those belong on vm up / ssh-info).
  return sharedDryRun(
    sharedLibvirt(yargs)
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
      .option('remote-dir', {
        type: 'string',
        default: '/tank/rocky',
        describe: 'Guest instance repo path',
      })
      .option('identity', {
        type: 'string',
        describe: 'SSH private key path (default: ~/.ssh/id_ed25519|id_rsa or ssh-agent)',
      })
      .option('ssh-timeout', {
        type: 'number',
        default: 180,
        describe: 'Seconds to wait for SSH before syncing (hint: qctl vm up on timeout)',
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
 *   sshTimeout?: number
 * }} argv
 */
export async function handler(argv) {
  await runSync(argv)
}
