import { die } from '../errors.js'
import { appDir, companionApps, unitDepApps } from './discovery.js'

/**
 * Unit deps + companions (unique, sorted).
 * @param {{ root: string }} ctx
 * @param {string} dir
 * @returns {string[]}
 */
export function depApps(ctx, dir) {
  return [...new Set([...unitDepApps(ctx, dir), ...companionApps(dir)])].sort()
}

/**
 * Transitive deps to install alongside `app` (not including `app`).
 * @param {{ root: string }} ctx
 * @param {string} app
 * @returns {string[]}
 */
export function expandUnitDepApps(ctx, app) {
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {string[]} */
  const out = []
  const stack = [app]
  while (stack.length > 0) {
    const cur = /** @type {string} */ (stack.pop())
    const d = appDir(ctx, cur)
    if (!d) continue
    for (const dep of depApps(ctx, d)) {
      if (dep === app || seen.has(dep)) continue
      seen.add(dep)
      out.push(dep)
      stack.push(dep)
    }
  }
  return out
}

/**
 * Start order: dependencies before dependents (Kahn, sorted ties). Dies on cycle.
 * @param {{ root: string }} ctx
 * @param {string[]} apps
 * @returns {string[]}
 */
export function topoSortApps(ctx, apps) {
  if (apps.length === 0) return []
  const inSet = new Set(apps)
  /** @type {Map<string, number>} */
  const indeg = new Map(apps.map((a) => [a, 0]))
  /** @type {Map<string, string[]>} */
  const adj = new Map()
  for (const a of apps) {
    const d = appDir(ctx, a)
    if (!d) continue
    for (const dep of depApps(ctx, d)) {
      if (!inSet.has(dep)) continue
      adj.set(dep, [...(adj.get(dep) ?? []), a])
      indeg.set(a, (indeg.get(a) ?? 0) + 1)
    }
  }
  let queue = apps.filter((a) => indeg.get(a) === 0).sort()
  /** @type {string[]} */
  const out = []
  while (queue.length > 0) {
    const a = /** @type {string} */ (queue.shift())
    out.push(a)
    /** @type {string[]} */
    const newly = []
    for (const next of adj.get(a) ?? []) {
      const n = (indeg.get(next) ?? 0) - 1
      indeg.set(next, n)
      if (n === 0) newly.push(next)
    }
    queue = [...queue, ...newly.sort()]
  }
  if (out.length !== apps.length) die(`unit dependency cycle among: ${apps.join(' ')}`)
  return out
}

export { unitDepApps }
