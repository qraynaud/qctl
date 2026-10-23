import { chalk } from 'zx'

import { sharedDryRun, sharedLibvirt } from '../../lib/options.js'
import { resolveSyncEndpoint } from '../../sync/endpoint.js'
import { waitForSsh } from '../../sync/wait-ssh.js'
import { loadDriver } from '../drivers/index.js'
import { resolveVmAppSelection } from '../libs/guest-apps.js'
import { guestQuadletDown } from '../libs/guest-quadlet.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'down [apps..]'
export const describe =
  'With apps/--all: stop guest apps only; with no apps: shut down the whole VM'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedDryRun(sharedLibvirt(yargs))
    .positional('apps', {
      type: 'string',
      array: true,
      describe: 'Guest apps to quadlet down (omit = ACPI shut down the VM)',
    })
    .option('all', {
      type: 'boolean',
      default: false,
      describe: 'Quadlet down every applications/*/app.yaml (do not power off the VM)',
    })
    .option('timeout', {
      type: 'number',
      default: 120,
      describe: 'Seconds to wait for shut off after ACPI shutdown (bare down only)',
    })
    .option('force', {
      type: 'boolean',
      default: false,
      describe: 'Force poweroff if still running after timeout (bare down only)',
    })
    .option('ssh-timeout', {
      type: 'number',
      default: 60,
      describe: 'Seconds to wait for SSH before guest quadlet down (apps/--all only)',
    })
    .option('network', {
      choices: ['auto', 'default', 'user'],
      default: 'user',
      describe: 'How to reach the guest for apps/--all (user/auto: passt; default: DHCP)',
    })
    .option('user', {
      type: 'string',
      default: 'rocky',
      describe: 'SSH user for guest quadlet (apps/--all)',
    })
    .option('host', {
      type: 'string',
      describe: 'SSH host override (required for proxmox when using apps/--all)',
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
 *   apps?: string[]
 *   all?: boolean
 *   sshTimeout?: number
 *   user?: string
 *   host?: string
 *   port?: number
 *   identity?: string
 * }} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const selection = resolveVmAppSelection(argv)

  if (selection.mode === 'none') {
    const driver = await loadDriver(argv)
    console.log(
      chalk.cyan('vm down'),
      chalk.dim(
        `profile=${argv.profile ?? '(default)'} target=${argv.target} env=${argv.env} name=${argv.name}`,
      ),
    )
    await driver.down(argv)
    return
  }

  const apps = selection.apps
  console.log(
    chalk.cyan('vm down'),
    chalk.dim(
      `profile=${argv.profile ?? '(default)'} apps=${apps.join(',')} (guest only; VM stays up)`,
    ),
  )

  if (argv.dryRun) {
    console.log(
      chalk.dim(`  [dry-run] would wait for SSH then qctl quadlet down ${apps.join(' ')}`),
    )
    return
  }

  const ep = await resolveSyncEndpoint(argv)
  await waitForSsh({
    host: ep.host,
    port: ep.port,
    username: ep.username,
    identity: ep.identity,
    timeoutSec: argv.sshTimeout ?? 60,
    label: ep.label,
  })
  await guestQuadletDown(ep, apps)
}
