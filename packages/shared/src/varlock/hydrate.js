import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Read one systemd credential file (strip a single trailing newline only).
 * @param {string} filePath
 * @returns {string}
 */
function readCredentialFile(filePath) {
  let s = readFileSync(filePath, 'utf8')
  if (s.endsWith('\r\n')) s = s.slice(0, -2)
  else if (s.endsWith('\n') || s.endsWith('\r')) s = s.slice(0, -1)
  return s
}

/**
 * Load every file in `CREDENTIALS_DIRECTORY` into `overrideValues` when the key is unset.
 * Filename = schema / env key (backend-agnostic: `VW_CLIENT_ID`, `OP_TOKEN`, …).
 *
 * Pair with `# @tag(guest)` on those schema items and
 * `LoadCredentialEncrypted=<KEY>` on the unit that runs qctl.
 *
 * @param {Record<string, string | undefined>} overrideValues
 * @returns {string[]} keys hydrated
 */
export function hydrateSystemdCredentials(overrideValues) {
  const dir = (overrideValues.CREDENTIALS_DIRECTORY || '').trim()
  if (!dir || !existsSync(dir)) return []

  /** @type {Map<string, string>} */
  const files = new Map()
  try {
    for (const name of readdirSync(dir)) {
      if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\')) continue
      const p = join(dir, name)
      try {
        if (!existsSync(p)) continue
        files.set(name, readCredentialFile(p))
      } catch {
        // skip unreadable
      }
    }
  } catch {
    return []
  }

  /** @type {string[]} */
  const hydrated = []
  for (const [name, value] of files) {
    if (overrideValues[name]?.length) continue
    if (value === '') continue
    overrideValues[name] = value
    hydrated.push(name)
  }
  return hydrated
}
