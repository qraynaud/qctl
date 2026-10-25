/**
 * Argv → { module, ctx, specs }. No builtin side-effect imports (callers ensure registry).
 */
import { resolveBootResources } from '../../lib/options.js'
import { resolveProfileArgv } from '../../lib/profile-argv.js'
import { die } from '../../lib/util.js'
import { toVmContext, toVmSpecs } from '../context.js'
import { asVmDriverId, getDriverModule, resolveNameForModule } from './registry.js'

/** @import { VmContext, VmSpecs } from '../driver-contract.js' */
/** @import { VmArgv } from '../types.js' */

/**
 * Resolve profile → name / boot resources → registered module + context + soft specs.
 * @param {VmArgv} argv
 * @returns {Promise<{
 *   module: NonNullable<ReturnType<typeof getDriverModule>>,
 *   ctx: VmContext,
 *   specs: Partial<VmSpecs>,
 * }>}
 */
export async function resolveDriver(argv) {
  resolveProfileArgv(argv)
  const id = asVmDriverId(argv.target || 'workstation')
  const mod = getDriverModule(id)
  if (!mod) die(`unknown target ${id}`)

  argv.target = String(mod.id)
  argv.name = resolveNameForModule(mod, {
    name: argv.name,
    env: argv.env,
    production: argv.production,
  })
  resolveBootResources(argv)

  return {
    module: mod,
    ctx: toVmContext(argv),
    specs: toVmSpecs(argv),
  }
}
