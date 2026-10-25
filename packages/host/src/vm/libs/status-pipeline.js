/**
 * Shared `qctl vm status` / `ssh-info` — print {@link VmStatusSnapshot} from the module.
 */
import { chalk } from 'zx'

import { die } from '../../lib/util.js'

/** @import { VmContext, VmDriverRegistration, VmStatusSnapshot } from '../driver-contract.js' */

/**
 * @param {VmStatusSnapshot} snap
 * @param {{ hintsOnly?: boolean }} [opts]
 * @returns {void}
 */
export function printVmStatusSnapshot(snap, opts = {}) {
  if (!opts.hintsOnly) {
    if (snap.summary) {
      const absentish =
        snap.power.kind === 'absent'
        || /not (defined|found)/i.test(snap.summary)
        || /^would query/i.test(snap.summary)
      console.log(absentish ? chalk.yellow(`vm: ${snap.summary}`) : snap.summary)
    } else {
      console.log(
        chalk.cyan(`vm:`),
        `power=${snap.power.kind}${snap.power.detail ? ` (${snap.power.detail})` : ''}`,
      )
    }
    if (snap.fields) {
      for (const [k, v] of Object.entries(snap.fields)) {
        if (v == null) continue
        if (k === 'disksError') {
          console.log(chalk.dim(`  (could not resolve disks: ${v})`))
          continue
        }
        console.log(`  ${k}: ${v}`)
      }
    }
    if (snap.disks?.length) {
      for (const d of snap.disks) {
        console.log(`  ${d.id}: ${d.exists ? d.path : '(missing)'}`)
      }
    }
  }

  if (!snap.hints?.lines?.length) return
  console.log(chalk.cyan(`\n${snap.hints.title || 'Shell'}`))
  for (const line of snap.hints.lines) {
    if (line.startsWith('cockpit:')) {
      console.log(chalk.cyan('\nCockpit'))
      console.log(`  ${line.replace(/^cockpit:\s*/, '')}`)
      continue
    }
    if (line.startsWith('hint:')) {
      console.log(chalk.yellow(`  ${line}`))
      continue
    }
    console.log(chalk.dim(`  ${line}`))
  }
}

/**
 * @param {VmContext} ctx
 * @param {VmDriverRegistration} module
 * @returns {Promise<void>}
 */
export async function runVmStatus(ctx, module) {
  if (!module.getStatus) {
    die(`runVmStatus: module ${module.id} missing getStatus`)
  }
  if (ctx.dryRun && String(module.id) === 'proxmox') {
    // Preserve prior dry-run stub for proxmox status.
    console.log(chalk.dim(`vm: would query Proxmox VM name=${ctx.name}`))
    return
  }
  const snap = await module.getStatus(ctx)
  printVmStatusSnapshot(snap)
}

/**
 * @param {VmContext} ctx
 * @param {VmDriverRegistration} module
 * @returns {Promise<void>}
 */
export async function runVmSshInfo(ctx, module) {
  if (!module.getStatus) {
    die(`runVmSshInfo: module ${module.id} missing getStatus`)
  }
  const snap = await module.getStatus(ctx)
  if (!snap.hints?.lines?.length) {
    console.log(chalk.cyan('\nShell'))
    console.log(chalk.dim('  (no SSH hints for this target)'))
    return
  }
  printVmStatusSnapshot(snap, { hintsOnly: true })
}
