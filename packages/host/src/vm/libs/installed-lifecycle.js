/**
 * Install-state helpers shared by `vm up` (no hypervisor types).
 * Drivers inject a bound {@link VmFlagStore} and a `scrubSeed` closure.
 */
import { chalk, fs } from 'zx'

import { INSTALLED } from './flags.js'
import { resolveSeedPaths } from './seed/iso.js'

/** @import { SeedProfile } from '../types.js' */
/** @import { VmFlagStore } from './flag-store.js' */

/**
 * @param {VmFlagStore} flags
 * @returns {Promise<boolean>}
 */
export async function isInstalled(flags) {
  if (!(await flags.has(INSTALLED))) return false
  return (await flags.get(INSTALLED)) === true
}

/**
 * Drop the installed marker only (wipe / destroy OS). Does not scrub seed files.
 * @param {VmFlagStore} flags
 * @returns {Promise<void>}
 */
export async function clearInstalled(flags) {
  if (await flags.has(INSTALLED)) await flags.delete(INSTALLED)
}

/**
 * Mark first-boot complete, then scrub seed (secrets). Order is set-then-scrub so a
 * failed scrub still leaves the VM marked installed (re-run scrub is safe).
 * @param {VmFlagStore} flags
 * @param {{ scrubSeed: () => void | Promise<void> }} opts
 * @returns {Promise<void>}
 */
export async function markInstalled(flags, { scrubSeed }) {
  await flags.set(INSTALLED, true)
  await scrubSeed()
}

/**
 * Delete local Tier-0-bearing seed artifacts for an env. Keeps `instance-id` so a
 * later wipe re-seed stays stable by default.
 * @param {{
 *   env?: string,
 *   seedProfile?: SeedProfile | string,
 * }} [opts]
 * @returns {Promise<{ removed: string[] }>}
 */
export async function scrubLocalSeedArtifacts(opts = {}) {
  const paths = resolveSeedPaths(opts.seedProfile || 'appliance', opts.env || 'dev')
  /** @type {string[]} */
  const removed = []
  for (const p of [paths.isoPath, paths.imgPath]) {
    if (!p || !fs.existsSync(p)) continue
    await fs.remove(p)
    removed.push(p)
    console.log(chalk.dim(`vm: scrubbed seed artifact ${p}`))
  }
  return { removed }
}

/**
 * `scrubSeed` callback: local artifacts, then an optional driver hook (detach ISO, …).
 * @param {{
 *   env?: string,
 *   seedProfile?: SeedProfile | string,
 *   after?: () => void | Promise<void>,
 * }} opts
 * @returns {() => Promise<void>}
 */
export function composeScrubSeed(opts) {
  return async () => {
    await scrubLocalSeedArtifacts({
      env: opts.env,
      seedProfile: opts.seedProfile,
    })
    if (opts.after) await opts.after()
  }
}
