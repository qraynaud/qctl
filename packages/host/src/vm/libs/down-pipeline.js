/**
 * Shared `qctl vm down` orchestration over a thin {@link VmDriverModule}.
 */
import { chalk } from 'zx'

import { die } from '../../lib/util.js'
import { sleep } from './wait.js'

/** @import { VmContext, VmDownOptions, VmDriverRegistration } from '../driver-contract.js' */

/**
 * @param {VmContext} ctx
 * @param {VmDownOptions} opts
 * @param {VmDriverRegistration} module
 * @returns {Promise<void>}
 */
export async function runVmDown(ctx, opts, module) {
  if (!module.find || !module.stop || !module.powerState) {
    die(`runVmDown: module ${module.id} missing find/stop/powerState`)
  }
  const name = String(ctx.name).trim()
  const timeoutSec = opts.timeout ?? ctx.timeout ?? 120

  if (ctx.dryRun) {
    console.log(chalk.dim(`vm: would shut down ${name} (wait ≤${timeoutSec}s)`))
    return
  }

  const vm = await module.find(ctx)
  if (!vm) die(`VM ${name} not found`)

  const before = await module.powerState(ctx)
  if (before.kind === 'stopped') {
    await module.stop(ctx, vm, { force: false })
    console.log(chalk.green(`vm: ${name} already stopped`))
    return
  }
  if (before.kind === 'absent') die(`VM ${name} not found`)

  console.log(chalk.cyan(`vm: shutdown requested for ${name}`))
  await module.stop(ctx, vm, { force: false })

  const deadline = Date.now() + timeoutSec * 1000
  while (Date.now() < deadline) {
    const p = await module.powerState(ctx)
    if (p.kind === 'stopped' || p.kind === 'absent') {
      console.log(chalk.green(`vm: ${name} stopped`))
      return
    }
    await sleep(2000)
  }

  if (opts.force) {
    console.log(chalk.yellow(`vm: still running after ${timeoutSec}s — forcing poweroff`))
    await module.stop(ctx, vm, { force: true })
    console.log(chalk.green(`vm: ${name} stopped (forced)`))
    return
  }

  const final = await module.powerState(ctx)
  die(
    `VM ${name} still ${final.detail || final.kind} after ${timeoutSec}s — `
      + `retry down --force, or check guest ACPI`,
  )
}
