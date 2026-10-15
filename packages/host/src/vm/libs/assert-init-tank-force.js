/**
 * init-tank: existing virtual tank member qcow2s require -f to recreate.
 * Physical members are left to the guest (importable pool check).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { chalk } from 'zx'

import { getVms } from '../../lib/paths.js'
import { die } from '../../lib/util.js'
import { withAttachModes } from './attach-mode.js'

/** @import { ResolvedDiskMember } from '../../provision/schema/resolve-disks.js' */

/**
 * @param {{
 *   name: string,
 *   members: ResolvedDiskMember[],
 *   force?: boolean,
 * }} opts
 */
export function assertInitTankForceOrFresh({ name, members, force }) {
  if (force) return
  const classified = withAttachModes(members)
  const dir = join(getVms(), name)
  /** @type {string[]} */
  const existing = []
  for (const m of classified) {
    if (m.kind !== 'tank' || m.mode !== 'virtual') continue
    const qcow = join(dir, `${m.id}.qcow2`)
    if (existsSync(qcow)) existing.push(m.id)
  }
  if (!existing.length) return
  die(
    `init-tank: tank member(s) already present: ${existing.join(', ')}\n`
      + `  pass -f to recreate the pool on those members only (data volumes stay)`,
  )
}

/**
 * @param {string[]} poolIds
 */
export function logInitTankPools(poolIds) {
  console.log(chalk.dim(`  pools: ${poolIds.join(', ')}`))
}
