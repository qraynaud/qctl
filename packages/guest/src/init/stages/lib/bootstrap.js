/**
 * Decode seed attachment payloads. Accepts raw bytes as utf8, or base64
 * (with optional `base64,` / `data:…;base64,` prefix).
 * @param {string} raw
 * @returns {Buffer}
 */
export function decodeBootstrapBytes(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return Buffer.alloc(0)
  const b64 = s.replace(/^data:[^;]+;base64,/i, '').replace(/^base64,/i, '')
  if (b64.includes('BEGIN ') || b64.includes('PRIVATE KEY')) {
    return Buffer.from(s, 'utf8')
  }
  try {
    const buf = Buffer.from(b64, 'base64')
    if (buf.length > 0 && b64.length >= 8) return buf
  } catch {
    /* fall through */
  }
  return Buffer.from(s, 'utf8')
}
