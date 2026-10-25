/**
 * Deployment target helpers. VM default names come from the driver registry.
 */

import { asVmDriverId, getDriverModule, resolveNameForModule } from '../vm/drivers/registry.js'

// Builtin self-registration (side-effect) so defaultVmName works before resolveDriver.
import '../vm/drivers/proxmox.js'
import '../vm/drivers/workstation.js'

/** @import { VmArgv, VmEnv, VmTarget } from '../vm/types.js' */

/** Profile / driver target values (not a user CLI flag). Closed until overlay phase. */
export const TARGETS = /** @type {const} */ (['workstation', 'proxmox'])

/**
 * Default VM name when --name is omitted — delegates to the registered module.
 * @param {{
 *   target?: VmTarget | string,
 *   env?: VmEnv | string,
 *   production?: boolean,
 *   environments?: Record<string, { production?: boolean }>,
 * }} opts
 * @returns {string}
 */
export function defaultVmName({ target, env, production, environments }) {
  const id = asVmDriverId(target || 'workstation')
  const mod = getDriverModule(id)
  if (!mod?.defaultVmName) {
    throw new Error(`defaultVmName: driver ${id} has no defaultVmName`)
  }
  return mod.defaultVmName({ env, production, environments })
}

/**
 * Resolve name after yargs parse. Call from handlers (middleware order is fragile
 * with commandDir).
 * @param {VmArgv} argv
 * @returns {string}
 */
export function resolveVmName(argv) {
  const id = asVmDriverId(argv.target || 'workstation')
  const mod = getDriverModule(id)
  if (!mod) throw new Error(`resolveVmName: unknown target ${id}`)
  return resolveNameForModule(mod, {
    name: argv.name,
    env: argv.env,
    production: argv.production,
  })
}
