import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * App names under `applications/<name>/app.yaml`.
 * @param {string} instanceRoot
 * @returns {string[]}
 */
export function listInstanceApps(instanceRoot) {
  const dir = join(instanceRoot, 'applications')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'app.yaml')))
    .map((d) => d.name)
    .sort()
}
