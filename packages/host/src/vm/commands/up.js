import { chalk } from 'zx'

import { sharedBoot, sharedDryRun } from '../../lib/options.js'
import { resolveSyncEndpoint } from '../../sync/endpoint.js'
import { waitForSsh } from '../../sync/wait-ssh.js'
import { loadDriver } from '../drivers/index.js'
import { resolveVmAppSelection } from '../libs/guest-apps.js'
import { guestQuadletUp, guestQuadletUpAll } from '../libs/guest-quadlet.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'up [apps..]'
export const describe =
  'Start the VM (create if missing); with apps/--all, also quadlet-up those apps on the guest'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedDryRun(sharedBoot(yargs))
    .positional('apps', {
      type: 'string',
      array: true,
      describe: 'Guest apps to quadlet up after the VM is ready (omit = VM only)',
    })
    .option('all', {
      type: 'boolean',
      default: false,
      describe: 'After VM ready: quadlet up every applications/*/app.yaml',
    })
    .option('wipe-os', {
      type: 'boolean',
      default: false,
      describe:
        'Recreate disks.os only (undefine + fresh OS overlay); leave data + tank members untouched',
    })
    .option('force-download', {
      type: 'boolean',
      default: false,
      describe: 'Re-download cloud image even if cached',
    })
    .option('timeout', {
      type: 'number',
      default: 2700,
      describe: 'Seconds to wait for boot ready (default 45m)',
    })
    .option('ssh-timeout', {
      type: 'number',
      default: 180,
      describe: 'Seconds to wait for SSH before guest quadlet up (apps/--all only)',
    })
    .option('no-console', {
      type: 'boolean',
      default: false,
      describe: 'Do not stream serial / wait for boot (exit after create/start)',
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
  const driver = await loadDriver(argv)
  console.log(
    chalk.cyan('vm up'),
    chalk.dim(
      `profile=${argv.profile ?? '(default)'} target=${argv.target} `
        + `env=${argv.env} name=${argv.name}`,
    ),
  )
  await driver.up(argv)

  if (selection.mode === 'none') return

  if (argv.dryRun) {
    const who =
      selection.mode === 'all' ? `all (${selection.apps.join(', ')})` : selection.apps.join(', ')
    console.log(chalk.dim(`  [dry-run] would wait for SSH then qctl quadlet up ${who}`))
    return
  }

  const ep = await resolveSyncEndpoint(argv)
  await waitForSsh({
    host: ep.host,
    port: ep.port,
    username: ep.username,
    identity: ep.identity,
    timeoutSec: argv.sshTimeout ?? 180,
    label: ep.label,
  })

  if (selection.mode === 'all') await guestQuadletUpAll(ep)
  else await guestQuadletUp(ep, selection.apps)
}
