import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { isInstanceRoot } from '@qctl/shared'

import {
  GITIGNORE,
  MISE_TOML,
  PACKAGE_JSON,
  PROVISION_COMMON_YAML,
  PROVISION_DEV_LOCAL_YAML,
  PROVISION_DEV_PROXMOX_YAML,
  PROVISION_DEV_YAML,
  PROVISION_ENV_DEV,
  PROVISION_ENV_PROD,
  PROVISION_ENV_SCHEMA,
  PROVISION_README,
  ROOT_ENV_DEV,
  ROOT_ENV_PROD,
  ROOT_ENV_SCHEMA,
} from './templates.js'

/**
 * @param {string} path
 * @param {string} contents
 * @param {{ force?: boolean }} [opts]
 * @returns {'wrote' | 'skipped'}
 */
function writeNew(path, contents, opts = {}) {
  if (existsSync(path) && !opts.force) return 'skipped'
  writeFileSync(path, contents, 'utf8')
  return 'wrote'
}

/**
 * Scaffold a new instance repo.
 * @param {string} dir
 * @param {{ force?: boolean }} [opts]
 */
export function initInstance(dir, opts = {}) {
  const root = resolve(dir)
  mkdirSync(root, { recursive: true })

  if (isInstanceRoot(root) && !opts.force) {
    throw new Error(
      `${root} already looks like a qctl instance (provision/ with qctl:). Pass --force to overwrite scaffold files.`,
    )
  }

  /** @type {string[]} */
  const written = []
  /** @type {string[]} */
  const skipped = []

  /**
   * @param {string} rel
   * @param {string} contents
   */
  const put = (rel, contents) => {
    const path = join(root, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    const result = writeNew(path, contents, opts)
    ;(result === 'wrote' ? written : skipped).push(rel)
  }

  put('mise.toml', MISE_TOML)
  put('package.json', PACKAGE_JSON)
  put('.env.schema', ROOT_ENV_SCHEMA)
  put('.env.dev', ROOT_ENV_DEV)
  put('.env.prod', ROOT_ENV_PROD)
  put('.gitignore', GITIGNORE)
  put('provision/common.yaml', PROVISION_COMMON_YAML)
  put('provision/dev.yaml', PROVISION_DEV_YAML)
  put('provision/dev.local.yaml', PROVISION_DEV_LOCAL_YAML)
  put('provision/dev.proxmox.yaml', PROVISION_DEV_PROXMOX_YAML)
  put('provision/README.md', PROVISION_README)
  put('provision/.env.schema', PROVISION_ENV_SCHEMA)
  put('provision/.env.dev', PROVISION_ENV_DEV)
  put('provision/.env.prod', PROVISION_ENV_PROD)

  for (const tree of ['applications', 'common', 'networks']) {
    mkdirSync(join(root, tree), { recursive: true })
    put(`${tree}/.gitkeep`, '')
  }

  return { root, written, skipped }
}
