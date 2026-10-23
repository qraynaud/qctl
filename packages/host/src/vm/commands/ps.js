import { chalk } from 'zx'

import { sharedLibvirt } from '../../lib/options.js'
import { resolveSyncEndpoint } from '../../sync/endpoint.js'
import { loadDriver } from '../drivers/index.js'
import { guestQuadletPs } from '../libs/guest-quadlet.js'
import { resolveVmPowerState } from '../libs/power-state.js'

/** @import { Argv } from 'yargs' */
/** @import { VmArgv } from '../types.js' */

export const command = 'ps [apps..]'
export const describe = 'VM power state and guest quadlet ps (mirror of local ps)'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedLibvirt(yargs)
    .positional('apps', {
      type: 'string',
      array: true,
      describe: 'Limit guest quadlet ps to these apps',
    })
    .option('network', {
      choices: ['auto', 'default', 'user'],
      default: 'user',
      describe: 'How to reach the guest (user/auto: passt; default: DHCP)',
    })
    .option('user', {
      type: 'string',
      default: 'rocky',
      describe: 'SSH user for guest quadlet ps',
    })
    .option('host', {
      type: 'string',
      describe: 'SSH host override (required for proxmox)',
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
 * @param {string[] | undefined} apps
 * @returns {string[]}
 */
function argvApps(apps) {
  return (apps ?? []).map(String).filter(Boolean)
}

/**
 * @param {VmArgv & {
 *   apps?: string[]
 *   user?: string
 *   host?: string
 *   port?: number
 *   identity?: string
 * }} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  try {
    const driver = await loadDriver(argv)
    const power = await resolveVmPowerState(driver, argv)
    const apps = argvApps(argv.apps)

    console.log(
      chalk.cyan('vm ps'),
      chalk.dim(
        `profile=${argv.profile ?? '(default)'} target=${argv.target} `
          + `env=${argv.env} name=${argv.name}`,
      ),
    )

    if (power.kind === 'running') {
      console.log(`  vm: ${chalk.green('running')}`)
    } else if (power.kind === 'stopped') {
      const label = power.detail && power.detail !== 'shut off' ? power.detail : 'stopped'
      console.log(`  vm: ${chalk.yellow(label)}`)
    } else {
      console.log(`  vm: ${chalk.dim('absent')}`)
    }

    if (power.kind !== 'running') {
      console.log(chalk.dim('  start with `qctl vm up`'))
      return
    }

    const ep = await resolveSyncEndpoint(argv)
    console.log(chalk.dim(`  ssh: ${ep.label}`))
    try {
      const code = await guestQuadletPs(ep, apps)
      if (code !== 0) process.exitCode = code
    } catch (err) {
      console.error(
        chalk.yellow(
          `  guest unreachable (${err instanceof Error ? err.message : err}) — `
            + 'is SSH up? try `qctl vm up` / `qctl vm shell`',
        ),
      )
      process.exitCode = 1
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
