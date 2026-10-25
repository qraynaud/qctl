/**
 * Shared `qctl vm destroy` orchestration over a thin {@link VmDriverModule}.
 */
import { chalk } from 'zx'

import { die } from '../../lib/util.js'
import { clearInstalled } from './installed-lifecycle.js'

/** @import { VmContext, VmDestroyOptions, VmDriverRegistration } from '../driver-contract.js' */

/**
 * @param {VmContext} ctx
 * @param {VmDestroyOptions} opts
 * @param {VmDriverRegistration} module
 * @returns {Promise<void>}
 */
export async function runVmDestroy(ctx, opts, module) {
  if (!module.find || !module.destroy) {
    die(`runVmDestroy: module ${module.id} missing find/destroy`)
  }
  const name = String(ctx.name).trim()
  const keep = opts.keepDisks ?? []

  if (ctx.dryRun) {
    console.log(
      chalk.dim(`vm: would destroy ${name} (keepDisks=${keep.length ? keep.join(',') : '(none)'})`),
    )
    return
  }

  const vm = await module.find(ctx)
  if (vm && module.createFlagStore) {
    await clearInstalled(await module.createFlagStore(ctx))
  } else if (!vm) {
    console.log(chalk.dim(`vm: ${name} not defined`))
  }

  await module.destroy(ctx, opts)
}
