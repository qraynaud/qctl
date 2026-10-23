/**
 * Locate and validate a qctl instance repo (provision/ + qctl: block).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { parseProvisionYaml } from './provision/index.js'

/** @import { YamlMapping } from './yaml.js' */

/**
 * @param {string} dir
 * @returns {boolean}
 */
export function hasQctlProvision(dir) {
  const provisionDir = join(dir, 'provision')
  if (!existsSync(provisionDir)) return false
  let entries
  try {
    entries = readdirSync(provisionDir)
  } catch {
    return false
  }
  for (const name of entries) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue
    if (name.includes('.workstation.') || name.includes('.proxmox.')) {
      // overlays may omit qctl:; still count if base has it
    }
    const path = join(provisionDir, name)
    try {
      const doc = parseProvisionYaml(readFileSync(path, 'utf8'), path)
      if (
        doc
        && typeof doc === 'object'
        && !Array.isArray(doc)
        && 'qctl' in /** @type {YamlMapping} */ (doc)
      ) {
        return true
      }
    } catch {
      // ignore unreadable / invalid while scanning
    }
  }
  return false
}

/**
 * Walk upward from `start` looking for an initialized instance root.
 * @param {string} [start]
 * @returns {string | null}
 */
export function findInstanceRoot(start = process.cwd()) {
  let dir = resolve(start)
  for (;;) {
    if (hasQctlProvision(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * @param {string} root
 * @returns {boolean}
 */
export function isInstanceRoot(root) {
  return hasQctlProvision(resolve(root))
}
