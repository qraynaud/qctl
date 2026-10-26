/**
 * Deep-merge provision YAML mappings (base ← overlay).
 * Named collections (ports/interfaces) are maps so keys merge.
 * Arrays are replaced by the overlay.
 */

/** @import { YamlMapping, YamlValue } from './yaml.js' */

/**
 * Plain YAML mapping (not array / scalar / bytes).
 *
 * @param {YamlValue | null | undefined} v
 * @returns {v is YamlMapping}
 */
export function isYamlMapping(v) {
  return (
    v != null
    && typeof v === 'object'
    && !Array.isArray(v)
    && !(v instanceof Uint8Array)
    && !(typeof Buffer !== 'undefined' && Buffer.isBuffer(v))
  )
}

/**
 * @param {YamlValue} base
 * @param {YamlValue | undefined} overlay
 * @returns {YamlValue}
 */
export function deepMerge(base, overlay) {
  if (overlay === undefined) return base
  if (overlay === null) return null
  if (!isYamlMapping(base) || !isYamlMapping(overlay)) return overlay

  /** @type {YamlMapping} */
  const out = { ...base }
  for (const [key, val] of Object.entries(overlay)) {
    if (Array.isArray(val)) {
      out[key] = val.map((x) => (isYamlMapping(x) ? { ...x } : x))
    } else if (isYamlMapping(val) && isYamlMapping(out[key])) {
      out[key] = deepMerge(out[key], val)
    } else {
      out[key] = val
    }
  }
  return out
}
