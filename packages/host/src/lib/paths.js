/**
 * Instance root + XDG cache/state paths for `qctl vm`.
 *
 * Instance root = nearest ancestor of cwd with a `provision/*.yaml` containing `qctl:`.
 *
 * Workstation artifacts (not in the repo):
 *   $XDG_CACHE_HOME/qctl/images/              shared cloud base images
 *   $XDG_CACHE_HOME/qctl/tooling/             materialized seed-kit (compiled host)
 *   $XDG_CACHE_HOME/qctl/repos/<hash>/seed/   NoCloud ISO + instance-id
 *   $XDG_DATA_HOME/qctl/repos/<hash>/vms/     libvirt disk images (kept; not GC'd)
 *
 * `<hash>` = first 16 hex chars of sha256(realpath(instance root)).
 * Overrides: `QCTL_CACHE_HOME`, `QCTL_DATA_HOME` (tests / custom layout).
 */

import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'

import { path } from 'zx'

import { findInstanceRoot, isInstanceRoot } from '@qctl/shared'

import { die } from './util.js'

/** @type {{ cwd: string, root: string | null } | null} */
let rootCache = null

/** @type {string | null} */
let seedKitRoot = null

/**
 * Instance root for the current working directory, or null.
 * Prefer `QCTL_INSTANCE_ROOT` when set (tests / wrappers that cannot rely on cwd).
 * @returns {string | null}
 */
export function tryGetRepoRoot() {
  const fromEnv = process.env.QCTL_INSTANCE_ROOT?.trim()
  if (fromEnv) {
    try {
      const root = realpathSync(fromEnv)
      if (isInstanceRoot(root)) return root
    } catch {
      // fall through to cwd walk
    }
  }
  const cwd = process.cwd()
  if (rootCache && rootCache.cwd === cwd) return rootCache.root
  rootCache = { cwd, root: findInstanceRoot(cwd) }
  return rootCache.root
}

/**
 * Instance root; exits with a clear error when not inside an instance repo.
 * @returns {string}
 */
export function getRepoRoot() {
  const root = tryGetRepoRoot()
  if (!root) {
    die(
      `not inside a qctl instance repo (no provision/*.yaml with a qctl: block above ${process.cwd()})\n`
        + '  Run `qctl init <dir>` to scaffold one, or cd into an existing instance.',
    )
  }
  return /** @type {string} */ (root)
}

/** Drop the cached root (tests). */
export function resetRepoRootCache() {
  rootCache = null
}

/** @param {string | null} dir */
export function setSeedKitRoot(dir) {
  seedKitRoot = dir
}

/** Clear seed-kit override (tests). */
export function resetSeedKitRoot() {
  seedKitRoot = null
}

/**
 * @param {string} root
 * @returns {boolean}
 */
export function isSeedKitRoot(root) {
  return Boolean(root && existsSync(path.join(root, 'cloud-init', 'user-data.yaml')))
}

/** @returns {string} <root>/provision */
export const getProvision = () => path.join(getRepoRoot(), 'provision')

/**
 * Rocky seed kit root (`cloud-init/`, `first-boot/`, `lib/`).
 * Prefer `QCTL_ROCKY_SEED`, else the path set by `ensurePlatformSeedKit`.
 * @returns {string}
 */
export function getSeedKit() {
  const fromEnv = process.env.QCTL_ROCKY_SEED
  if (fromEnv && isSeedKitRoot(fromEnv)) return fromEnv
  if (seedKitRoot && isSeedKitRoot(seedKitRoot)) return seedKitRoot
  die(
    'Rocky seed kit not resolved.\n'
      + '  Set QCTL_ROCKY_SEED, or run `qctl vm seed` (resolves host-embedded seed).',
  )
}

/** @returns {string} seed-kit/cloud-init */
export const getCloud = () => path.join(getSeedKit(), 'cloud-init')

/**
 * @param {string} [root]
 * @returns {string}
 */
export function repoHash(root) {
  const abs = realpathSync(root || getRepoRoot())
  return createHash('sha256').update(abs).digest('hex').slice(0, 16)
}

/** @returns {string} */
export function getCacheHome() {
  if (process.env.QCTL_CACHE_HOME?.trim()) return path.resolve(process.env.QCTL_CACHE_HOME.trim())
  const xdg = process.env.XDG_CACHE_HOME?.trim()
  if (xdg) return path.join(path.resolve(xdg), 'qctl')
  return path.join(homedir(), '.cache', 'qctl')
}

/** @returns {string} */
export function getDataHome() {
  if (process.env.QCTL_DATA_HOME?.trim()) return path.resolve(process.env.QCTL_DATA_HOME.trim())
  const xdg = process.env.XDG_DATA_HOME?.trim()
  if (xdg) return path.join(path.resolve(xdg), 'qctl')
  return path.join(homedir(), '.local', 'share', 'qctl')
}

/** Shared cloud base images. */
export const getImages = () => path.join(getCacheHome(), 'images')

/** Shared tooling cache (materialized seed kit, etc.). */
export const getTooling = () => path.join(getCacheHome(), 'tooling')

/** @returns {string} $CACHE/repos/<hash> */
export function getCacheRepo() {
  return path.join(getCacheHome(), 'repos', repoHash())
}

/** @returns {string} $DATA/repos/<hash> */
export function getDataRepo() {
  return path.join(getDataHome(), 'repos', repoHash())
}

/** Per-repo NoCloud seed artifacts. */
export const getSeed = () => path.join(getCacheRepo(), 'seed')

/** Per-repo VM disks (durable; not cache-GC'd). */
export const getVms = () => path.join(getDataRepo(), 'vms')
