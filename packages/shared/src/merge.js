/**
 * Deep-merge provision YAML mappings (base ← overlay).
 * Named collections (ports/uplinks/vlans/proxmox.net) are maps so keys merge.
 * Arrays are replaced by the overlay.
 */

/** @import { YamlMapping, YamlValue } from './yaml.js' */

/**
 * @param {YamlValue} v
 * @returns {v is YamlMapping}
 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * @param {YamlValue} base
 * @param {YamlValue | undefined} overlay
 * @returns {YamlValue}
 */
export function deepMerge(base, overlay) {
  if (overlay === undefined) return base
  if (overlay === null) return null
  if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay

  /** @type {YamlMapping} */
  const out = { ...base }
  for (const [key, val] of Object.entries(overlay)) {
    if (Array.isArray(val)) {
      out[key] = val.map((x) => (isPlainObject(x) ? { ...x } : x))
    } else if (isPlainObject(val) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], val)
    } else {
      out[key] = val
    }
  }
  return out
}
