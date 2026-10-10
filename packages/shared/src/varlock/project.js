import { isSensitiveItem } from './sensitivity.js'

/** @import { EnvGraph } from './builtins.js' */

/** @typedef {EnvGraph['configSchema'][string]} ConfigItem */

/**
 * Items in schema order.
 * @param {EnvGraph} graph
 * @returns {Array<[string, ConfigItem]>}
 */
function entries(graph) {
  return Object.entries(graph.configSchema)
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function stringify(v) {
  if (v === undefined || v === null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * Resolved non-`@sensitive` items as a string map. `@internal` items are skipped unless
 * `includeInternal` (Quadlet `${VAR}` substitution wants them). Unset values are omitted.
 *
 * @param {EnvGraph} graph
 * @param {{ includeInternal?: boolean }} [opts]
 * @returns {Record<string, string>}
 */
export function resolvedNonSensitive(graph, opts = {}) {
  /** @type {Set<string>} */
  const keys = new Set()
  for (const [key, item] of entries(graph)) {
    if (isSensitiveItem(item)) continue
    if (item.isInternal && !opts.includeInternal) continue
    keys.add(key)
  }
  const obj = graph.getResolvedEnvObject({
    includeInternal: opts.includeInternal === true,
    filterKeys: keys,
  })
  /** @type {Record<string, string>} */
  const out = {}
  for (const key of keys) {
    const v = obj[key]
    if (v === undefined || v === null) continue
    out[key] = stringify(v)
  }
  return out
}

/**
 * `@sensitive` items with their resolved string value (`""` when unresolved), sorted by key.
 * Skips `@internal` items — those are for varlock/plugin use, not Podman secret sync.
 *
 * @param {EnvGraph} graph
 * @returns {{ key: string, value: string }[]}
 */
export function resolvedSensitive(graph) {
  /** @type {{ key: string, value: string }[]} */
  const out = []
  for (const [key, item] of entries(graph)) {
    if (!isSensitiveItem(item)) continue
    if (item.isInternal) continue
    out.push({ key, value: stringify(item.resolvedValue) })
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/**
 * Keys declared sensitive in the graph.
 * @param {EnvGraph} graph
 * @returns {Set<string>}
 */
export function sensitiveKeys(graph) {
  return new Set(
    entries(graph)
      .filter(([, i]) => isSensitiveItem(i))
      .map(([k]) => k),
  )
}

/**
 * Keys carrying a `@tag(<tag>)` in the graph.
 * @param {EnvGraph} graph
 * @param {string} tag
 * @returns {Set<string>}
 */
export function keysWithTag(graph, tag) {
  return new Set(
    entries(graph)
      .filter(([, i]) => i.tags.includes(tag))
      .map(([k]) => k),
  )
}
