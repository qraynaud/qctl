import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { findInstanceRoot, isInstanceRoot } from '@qctl/shared'

import { listInstanceApps } from './local/apps.js'
import {
  appYaml,
  demoContainer,
  networkQuadletStub,
  packageReadme,
  stubContainer,
  treeEnvSchema,
  unitEnvDevStub,
  unitEnvSchema,
} from './templates.js'

/**
 * @typedef {'app' | 'common' | 'network'} NewKind
 * @typedef {'rootless' | 'rootful'} AppEngine
 * @typedef {'demo' | 'stub' | 'none'} UnitContainerKind
 *
 * @typedef {object} NewPackageOpts
 * @property {string} [cwd]
 * @property {boolean} [force]
 * @property {AppEngine | null} [engine] app only — write `app.yaml` when set
 * @property {boolean} [networkStub] network only — write `<name>.network` (default true)
 *
 * @typedef {object} NewUnitOpts
 * @property {string} [cwd]
 * @property {boolean} [force]
 * @property {UnitContainerKind} [container] default `stub`
 * @property {boolean} [envStub] write empty `.env.dev`
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
 * @param {string} [cwd]
 */
export function requireInstanceRoot(cwd) {
  const resolved = resolve(cwd ?? process.cwd())
  const root = findInstanceRoot(resolved)
  if (!root || !isInstanceRoot(root)) {
    throw new Error(
      `not a qctl instance (no provision/ with qctl:). Run \`qctl init\` first (cwd=${resolved}).`,
    )
  }
  return root
}

/**
 * Scaffold applications/<name>, common/<name>, or networks/<name>.
 * App units are **not** created here — use {@link newUnit} (see `qctl new app` / `qctl new unit`).
 * @param {NewKind} kind
 * @param {string} name
 * @param {NewPackageOpts} [opts]
 */
export function newPackage(kind, name, opts = {}) {
  assertName(name)
  const root = requireInstanceRoot(opts.cwd)

  const tree = /** @type {'applications' | 'common' | 'networks'} */ (dirFor(kind))
  const pkgDir = join(root, tree, name)
  if (existsSync(pkgDir) && !opts.force) {
    throw new Error(`${pkgDir} already exists (pass --force to overwrite scaffold files)`)
  }

  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, '.env.schema'), treeEnvSchema(tree, name), 'utf8')
  writeFileSync(join(pkgDir, 'README.md'), packageReadme(tree, name), 'utf8')

  /** @type {string[]} */
  const extra = []

  if (kind === 'app' && opts.engine) {
    writeFileSync(join(pkgDir, 'app.yaml'), appYaml(opts.engine), 'utf8')
    extra.push('app.yaml')
  }

  if (kind === 'network' && opts.networkStub !== false) {
    writeFileSync(join(pkgDir, `${name}.network`), networkQuadletStub(name), 'utf8')
    extra.push(`${name}.network`)
  }

  return { root, path: pkgDir, extra }
}

/**
 * Scaffold `applications/<app>/<name>/` (unit schema + optional env/container).
 * @param {string} app
 * @param {string} name
 * @param {NewUnitOpts} [opts]
 */
export function newUnit(app, name, opts = {}) {
  assertName(app)
  assertName(name)
  const root = requireInstanceRoot(opts.cwd)
  const appDir = join(root, 'applications', app)
  if (!existsSync(join(appDir, 'app.yaml'))) {
    throw new Error(
      `unknown app '${app}' (no applications/${app}/app.yaml). Run \`qctl new app\` first.`,
    )
  }

  const unitDir = join(appDir, name)
  if (existsSync(unitDir) && !opts.force) {
    throw new Error(`${unitDir} already exists (pass --force to overwrite scaffold files)`)
  }

  mkdirSync(unitDir, { recursive: true })
  writeFileSync(join(unitDir, '.env.schema'), unitEnvSchema(), 'utf8')

  /** @type {string[]} */
  const extra = ['.env.schema']

  if (opts.envStub) {
    writeFileSync(join(unitDir, '.env.dev'), unitEnvDevStub(), 'utf8')
    extra.push('.env.dev')
  }

  const container = opts.container ?? 'stub'
  if (container === 'demo') {
    writeFileSync(join(unitDir, `${name}.container`), demoContainer(name), 'utf8')
    extra.push(`${name}.container`)
  } else if (container === 'stub') {
    writeFileSync(join(unitDir, `${name}.container`), stubContainer(name), 'utf8')
    extra.push(`${name}.container`)
  }

  return {
    root,
    app,
    name,
    path: unitDir,
    extra: extra.map((rel) => `${name}/${rel}`),
  }
}

/**
 * Apps with `app.yaml` under the instance (for `new unit` select).
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function listAppsForNewUnit(cwd) {
  return listInstanceApps(requireInstanceRoot(cwd))
}
