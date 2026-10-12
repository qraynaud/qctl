/**
 * Single-quote for POSIX shells (`'` → `'\''`).
 * @param {string} s
 * @returns {string}
 */
export function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
