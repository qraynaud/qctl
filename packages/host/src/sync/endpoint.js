/**
 * Resolve SSH endpoint for `qctl sync` from the profile's env/target (+ overrides).
 * Delegates to {@link VmDriverModule.resolveEndpoint} — no host target branches.
 * Reachability (`user` / `default`) is derived from provision `ethernet.vm` modes.
 */
import { chalk } from 'zx'

import { loadEnvProvisionSafe } from '../lib/load-config.js'
import { toVmContext } from '../vm/context.js'
import { asVmDriverId, getDriverModule, resolveNameForModule } from '../vm/drivers/registry.js'
import { endpointNetworkFromNics, toVmNicsSpec } from '../vm/libs/nic-plan.js'

// Builtin self-registration.
import '../vm/drivers/proxmox.js'
import '../vm/drivers/workstation.js'

/** @import { VmArgv } from '../vm/types.js' */

/**
 * @typedef {object} SyncEndpoint
 * @property {string} host
 * @property {number} port
 * @property {string} username
 * @property {string} remoteDir
 * @property {string} [identity]
 * @property {string} label human-readable summary
 */

/**
 * @param {VmArgv & {
 *   user?: string
 *   host?: string
 *   port?: number
 *   remoteDir?: string
 *   identity?: string
 * }} argv
 * @returns {Promise<'user' | 'default'>}
 */
async function networkFromProvision(argv) {
  const profile = argv.profile
  if (profile == null || String(profile).trim() === '') return 'user'
  const loaded = await loadEnvProvisionSafe({
    env: argv.env || 'dev',
    target: String(argv.target || 'workstation'),
    profile,
  })
  if (!loaded.ok) return 'user'
  return endpointNetworkFromNics(toVmNicsSpec(loaded.provision.interfaces))
}

/**
 * @param {VmArgv & {
 *   user?: string
 *   host?: string
 *   port?: number
 *   remoteDir?: string
 *   identity?: string
 * }} argv
 * @returns {Promise<SyncEndpoint>}
 */
export async function resolveSyncEndpoint(argv) {
  const id = asVmDriverId(argv.target || 'workstation')
  const mod = getDriverModule(id)
  if (!mod?.resolveEndpoint) {
    throw new Error(`resolveSyncEndpoint: driver ${id} has no resolveEndpoint`)
  }

  argv.name = resolveNameForModule(mod, {
    name: argv.name,
    env: argv.env,
    production: argv.production,
  })

  const ctx = toVmContext(argv)
  return mod.resolveEndpoint(ctx, {
    user: argv.user,
    host: argv.host,
    port: argv.port,
    remoteDir: argv.remoteDir,
    identity: argv.identity,
    network: await networkFromProvision(argv),
  })
}

/**
 * @param {SyncEndpoint} ep
 */
export function logEndpoint(ep) {
  console.log(chalk.cyan('sync'), chalk.dim(ep.label))
}
