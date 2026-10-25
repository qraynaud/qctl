/**
 * Map Podman secret names → apps that reference them in `Secret=` Quadlet lines.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { globExts, listUnitDirs } from '../supervisor/quadlet/apps/index.js'

/**
 * @param {string} file .container path
 * @returns {string[]}
 */
export function secretNamesInContainer(file) {
  /** @type {string[]} */
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t.startsWith('Secret=') || t.startsWith('#')) continue
    const name = t.slice('Secret='.length).split(',')[0].trim()
    if (name) out.push(name)
  }
  return out
}

/**
 * Secret names referenced by `Secret=` in one app's containers.
 * @param {string} root
 * @param {string} app
 * @returns {Set<string>}
 */
export function secretNamesConsumedByApp(root, app) {
  /** @type {Set<string>} */
  const out = new Set()
  const appDir = join(root, 'applications', app)
  try {
    for (const unit of listUnitDirs(appDir)) {
      for (const file of globExts(unit, ['container'])) {
        for (const name of secretNamesInContainer(file)) out.add(name)
      }
    }
  } catch {
    // missing app
  }
  return out
}

/**
 * @param {string} root
 * @returns {Map<string, Set<string>>} secret name → app names
 */
export function discoverSecretConsumers(root) {
  /** @type {Map<string, Set<string>>} */
  const map = new Map()
  const appsDir = join(root, 'applications')
  let apps
  try {
    apps = readdirSync(appsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  } catch {
    return map
  }
  for (const app of apps) {
    for (const unit of listUnitDirs(join(appsDir, app))) {
      for (const file of globExts(unit, ['container'])) {
        for (const name of secretNamesInContainer(file)) {
          let set = map.get(name)
          if (!set) {
            set = new Set()
            map.set(name, set)
          }
          set.add(app)
        }
      }
    }
  }
  return map
}
