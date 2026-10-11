/**
 * Detect whether this process is a qctl monorepo checkout (vs an installed binary).
 * When true, seed/sync prefer `$root/dist` over GitHub release downloads.
 */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * @param {string} dir
 * @returns {boolean}
 */
export function isQctlSourceRoot(dir) {
  if (!dir) return false
  return (
    existsSync(join(dir, 'ci', 'compile.js'))
    && existsSync(join(dir, 'packages', 'host'))
    && existsSync(join(dir, 'package.json'))
  )
}

/**
 * @param {string} candidate
 * @returns {string | null}
 */
function asSourceRoot(candidate) {
  try {
    const root = realpathSync(candidate)
    return isQctlSourceRoot(root) ? root : null
  } catch {
    return null
  }
}

/**
 * Walk parents looking for a qctl monorepo root.
 * @param {string} start
 * @param {number} [maxHops]
 * @returns {string | null}
 */
function walkForSourceRoot(start, maxHops = 8) {
  let cur = start
  for (let i = 0; i < maxHops; i++) {
    const hit = asSourceRoot(cur)
    if (hit) return hit
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return null
}

/**
 * Monorepo root when running from a qctl checkout; otherwise null (installed host).
 * @returns {string | null}
 */
export function tryGetQctlSourceRoot() {
  /** @type {string[]} */
  const seeds = []

  // Source modules: …/packages/host/src/…
  try {
    seeds.push(dirname(fileURLToPath(import.meta.url)))
  } catch {
    // ignore
  }

  // Compiled binary at <checkout>/dist/qctl-host (mise path / bun compile).
  try {
    const exec = realpathSync(process.execPath)
    if (exec.endsWith(`${sep}qctl-host`)) seeds.push(dirname(exec))
  } catch {
    // ignore
  }

  // `bun …/packages/host/src/cli.js`
  try {
    const arg = process.argv[1]
    if (arg) seeds.push(dirname(realpathSync(arg)))
  } catch {
    // ignore
  }

  for (const seed of seeds) {
    const hit = walkForSourceRoot(seed)
    if (hit) return hit
  }
  return null
}

/**
 * `<checkout>/dist` when running from a local qctl repository.
 * @returns {string | null}
 */
export function tryGetLocalGuestDist() {
  const root = tryGetQctlSourceRoot()
  return root ? join(root, 'dist') : null
}
