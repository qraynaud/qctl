/**
 * Rocky appliance seed kit (cloud-init / first-boot / lib).
 * Owned by `@qctl/host` as `packages/host/seed`; compiled `qctl-host` embeds it
 * via `bun build --asset seed`.
 *
 * Resolution order:
 *   1. `QCTL_ROCKY_SEED` (tests / overrides)
 *   2. Workspace `packages/host/seed` (`bun run`)
 *   3. Bun `--asset seed` embed (`import.meta.dir/seed` inside compiled `qctl-host`)
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Workspace checkout: packages/host/seed next to this module's package root.
 * @returns {string}
 */
export function workspaceSeedRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'seed')
}

/**
 * Seed kit embedded into the compiled `qctl-host` via `bun build --asset seed`.
 * @returns {string}
 */
export function embeddedSeedRoot() {
  return join(import.meta.dir, 'seed')
}

/**
 * @param {string} root
 * @returns {boolean}
 */
export function isSeedRoot(root) {
  return Boolean(root && existsSync(join(root, 'cloud-init', 'user-data.yaml')))
}

/**
 * True when `root` lives on Bun's virtual SEA filesystem (host processes cannot read it).
 * @param {string} root
 * @returns {boolean}
 */
export function isEmbeddedSeedRoot(root) {
  return typeof root === 'string' && (root.includes('$bunfs') || root.startsWith('/$bunfs'))
}

/**
 * Effective seed kit root for the current process (may be a `$bunfs` path when compiled).
 * @returns {string}
 */
export function getRockySeedRoot() {
  const fromEnv = process.env.QCTL_ROCKY_SEED
  if (fromEnv && isSeedRoot(fromEnv)) return fromEnv

  const workspace = workspaceSeedRoot()
  if (isSeedRoot(workspace)) return workspace

  const embedded = embeddedSeedRoot()
  if (isSeedRoot(embedded)) return embedded

  throw new Error(
    'Rocky seed kit not found (cloud-init/user-data.yaml).\n'
      + '  Set QCTL_ROCKY_SEED, use a workspace checkout with packages/host/seed,'
      + ' or a qctl-host binary compiled with the seed asset.',
  )
}
