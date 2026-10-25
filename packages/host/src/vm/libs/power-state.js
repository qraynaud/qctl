/**
 * Lightweight VM power probe for `qctl vm ps` (not the verbose `vm status` dump).
 * Delegates to {@link VmDriverModule.powerState} — no host id branches.
 */

import { toVmContext } from '../context.js'
import { asVmDriverId, getDriverModule } from '../drivers/registry.js'

// Ensure builtins are registered when tests import this module alone.
import '../drivers/proxmox.js'
import '../drivers/workstation.js'

/** @import { VmContext, VmPowerState } from '../driver-contract.js' */
/** @import { VmArgv } from '../types.js' */

/**
 * @param {{ id: string }} driver
 * @param {VmArgv} argv  profile/name/boot already resolved by {@link resolveDriver}
 * @returns {Promise<VmPowerState>}
 */
export async function resolveVmPowerState(driver, argv) {
  const id = asVmDriverId(driver.id)
  const mod = getDriverModule(id)
  if (!mod?.powerState) {
    throw new Error(`resolveVmPowerState: driver ${id} has no powerState`)
  }
  return mod.powerState(toVmContext(/** @type {VmArgv} */ (argv)))
}

/**
 * Direct module entry (preferred by shared runners).
 * @param {{ powerState: (ctx: VmContext) => Promise<VmPowerState> }} module
 * @param {VmContext} ctx
 * @returns {Promise<VmPowerState>}
 */
export function powerStateFromModule(module, ctx) {
  return module.powerState(ctx)
}
