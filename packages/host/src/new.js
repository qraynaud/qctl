import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { findInstanceRoot, isInstanceRoot } from '@qctl/shared'

import { packageReadme, treeEnvSchema } from './templates.js'

/**
 * @typedef {'app' | 'common' | 'network'} NewKind
 */

/**
 * @param {NewKind} kind
 */
function dirFor(kind) {
  if (kind === 'app') return 'applications'
  if (kind === 'network') return 'networks'
  return 'common'
}

/**
 * @param {string} name
 */
function assertName(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `invalid name '${name}': use lowercase letters, digits, and hyphens (must start with a letter)`,
    )
  }
}

/**
 * Scaffold applications/<name>, common/<name>, or networks/<name>.
 * @param {NewKind} kind
 * @param {string} name
 * @param {{ cwd?: string, force?: boolean }} [opts]
 */
export function newPackage(kind, name, opts = {}) {
  assertName(name)
  const cwd = resolve(opts.cwd ?? process.cwd())
  const root = findInstanceRoot(cwd)
  if (!root || !isInstanceRoot(root)) {
    throw new Error(
      `not a qctl instance (no provision/ with qctl:). Run \`qctl init\` first (cwd=${cwd}).`,
    )
  }

  const tree = /** @type {'applications' | 'common' | 'networks'} */ (dirFor(kind))
  const pkgDir = join(root, tree, name)
  if (existsSync(pkgDir) && !opts.force) {
    throw new Error(`${pkgDir} already exists (pass --force to overwrite schema/README)`)
  }

  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, '.env.schema'), treeEnvSchema(tree, name), 'utf8')
  writeFileSync(join(pkgDir, 'README.md'), packageReadme(tree, name), 'utf8')

  return { root, path: pkgDir }
}
