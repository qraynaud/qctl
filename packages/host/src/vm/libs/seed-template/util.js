/**
 * Shared helpers for seed-template modules.
 */

/**
 * @param {string | null | undefined} s
 * @returns {string | null}
 */
export function withTrailingNewline(s) {
  if (s == null || s === '') return null
  const t = String(s)
  return t.endsWith('\n') ? t : `${t}\n`
}

/**
 * True when `s` is safe as a plain scalar in cloud-config YAML (PyYAML).
 * C0 controls (except tab / LF / CR) and DEL (0x7F) make cloud-init reject
 * the whole user-data as an "empty cloud config".
 *
 * @param {string} s
 * @returns {boolean}
 */
export function isCloudInitYamlSafe(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x9 || c === 0xa || c === 0xd) continue
    if (c < 0x20 || c === 0x7f) return false
  }
  return true
}
