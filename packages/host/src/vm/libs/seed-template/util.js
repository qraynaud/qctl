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
