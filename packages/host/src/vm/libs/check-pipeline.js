/**
 * Shared `qctl vm target-check` over a thin {@link VmDriverModule}.
 */
import { die } from '../../lib/util.js'
import { createCheckReport } from './check-report.js'

/** @import { VmContext, VmDriverRegistration } from '../driver-contract.js' */

/**
 * @param {VmContext} ctx
 * @param {VmDriverRegistration} module
 * @returns {Promise<boolean>}
 */
export async function runVmCheck(ctx, module) {
  if (module.targetCheck) {
    return module.targetCheck(ctx)
  }
  if (!module.collectCheckFacts) {
    die(`runVmCheck: module ${module.id} has no targetCheck/collectCheckFacts`)
  }
  const report = createCheckReport(String(module.id))
  report.section('Driver facts')
  const facts = await module.collectCheckFacts(ctx)
  for (const item of facts.items) {
    const msg = item.detail ? `${item.id}: ${item.detail}` : item.id
    if (item.ok) report.ok(msg)
    else report.fail(msg)
  }
  return report.finish()
}
