/**
 * Render env + Quadlet template `${VAR}` substitution.
 *
 * Values come from the **varlock graph** (`@qctl/shared`), never the `varlock` CLI:
 *   - package root (`applications/<app>/`): template scope — hub + `.env.<QCTL_ENV>` autoload
 *   - unit dir (`applications/<app>/<unit>/`): container EnvironmentFile=.env + secrets
 *
 * `@sensitive` must not appear in the package-root graph assignments used for render.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { loadEnvGraphForDir, resolvedNonSensitive, sensitiveKeys } from '@qctl/shared'

import { listUnitDirs } from './apps/index.js'
import { evalEnvText, listAssignedKeys } from './env/shellenv.js'
import { die } from './errors.js'

/** @import { Scope } from './env/shellenv.js' */

/**
 * @typedef {object} RenderEnv
 * @property {string} repoRoot
 * @property {Scope} scope
 * @property {string[]} substKeys
 * @property {string} qctlEnv
 * @property {Record<string, string>} graphValues
 *   package-root non-sensitive graph (path-absolutized in scope)
 * @property {Set<string>} sensitive  `@sensitive` keys seen while loading (package or unit)
 * @property {string} [appEnvLabel]
 */

const UNRESOLVED_RE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/g

/**
 * Keys whose relative values are made absolute against the repo root.
 * @param {string} key
 * @returns {boolean}
 */
export function isPathKey(key) {
  if (key === 'REPO_ROOT') return false
  return /(_ROOT|_DIR|_PATH|_BIN)$/.test(key)
}

/**
 * @param {RenderEnv} renv
 * @param {string} key
 */
function absolutizePathKey(renv, key) {
  if (!isPathKey(key)) return
  const val = renv.scope[key]
  if (val && !val.startsWith('/')) renv.scope[key] = resolve(renv.repoRoot, val)
}

/**
 * Seed-baked env (set -a; source) — values visible to templates only via
 * the derived keys below, not added to substKeys wholesale.
 * @param {Scope} scope
 * @param {string} file
 */
function sourceSeedEnv(scope, file) {
  if (existsSync(file)) evalEnvText(readFileSync(file, 'utf8'), scope, file)
}

/**
 * Which `QCTL_ENV` to load graphs with.
 * @param {{ root: string, baseEnv: Scope }} ctx
 * @returns {string}
 */
export function detectQctlEnv(ctx) {
  return detectQctlEnvFor(ctx.root, ctx.baseEnv)
}

/**
 * @param {string} root instance root
 * @param {Scope} baseEnv
 * @returns {string}
 */
export function detectQctlEnvFor(root, baseEnv) {
  if (baseEnv.QCTL_ENV) return baseEnv.QCTL_ENV
  const link = join(root, '.env')
  if (existsSync(link)) {
    /** @type {Scope} */
    const tmp = {}
    try {
      evalEnvText(readFileSync(link, 'utf8'), tmp, link)
    } catch {
      // unreadable / odd link target: fall through to the default
    }
    if (tmp.ENV) return tmp.ENV
  }
  return 'dev'
}

/**
 * Fresh render env: process env + REPO_ROOT + seed-baked derived keys. No graph values yet.
 * @param {{ root: string, baseEnv: Scope, seedDir: string }} ctx
 * @param {string} qctlEnv
 * @returns {RenderEnv}
 */
function seedRenderEnv(ctx, qctlEnv) {
  /** @type {RenderEnv} */
  const renv = {
    repoRoot: ctx.root,
    scope: { ...ctx.baseEnv, REPO_ROOT: ctx.root },
    substKeys: ['REPO_ROOT'],
    qctlEnv,
    graphValues: {},
    sensitive: new Set(),
  }

  sourceSeedEnv(renv.scope, join(ctx.seedDir, 'vlan-parents.env'))
  for (const k of Object.keys(renv.scope)) {
    if (/^VLAN.*(_PARENT|_IPV4)$/.test(k) && !renv.substKeys.includes(k)) renv.substKeys.push(k)
  }
  return renv
}

/**
 * Load the varlock graph for `dir` (non-sensitive items only) into the render env.
 * @param {RenderEnv} renv
 * @param {{ baseEnv: Scope, seedDir: string }} ctx
 * @param {string} dir directory holding `.env.schema`
 */
async function applyGraph(renv, ctx, dir) {
  const graph = await loadEnvGraphForDir(dir, {
    env: ctx.baseEnv,
    qctlEnv: renv.qctlEnv,
    skipSensitive: true,
    frozen: true,
  })
  renv.graphValues = resolvedNonSensitive(graph, { includeInternal: true })
  renv.sensitive = sensitiveKeys(graph)
  for (const [key, value] of Object.entries(renv.graphValues)) {
    renv.scope[key] = value
    absolutizePathKey(renv, key)
    if (!renv.substKeys.includes(key)) renv.substKeys.push(key)
  }
  // Host `qctl local` writes this after graph load so tank/apps ids win over .env.*
  applyLocalOverrides(renv, ctx.seedDir)
}

/**
 * Optional seed-dir overrides (e.g. nested lab `TANK_ROOT`).
 * @param {RenderEnv} renv
 * @param {string} seedDir
 */
function applyLocalOverrides(renv, seedDir) {
  const file = join(seedDir, 'local-overrides.env')
  if (!existsSync(file)) return
  /** @type {Scope} */
  const over = {}
  sourceSeedEnv(over, file)
  for (const [key, value] of Object.entries(over)) {
    renv.scope[key] = value
    absolutizePathKey(renv, key)
    if (!renv.substKeys.includes(key)) renv.substKeys.push(key)
  }
}

/**
 * Keys assigned in a directory's schema / `.env.<qctlEnv>` (for EnvironmentFile membership).
 * @param {string} dir
 * @param {string} qctlEnv
 * @returns {string[]}
 */
export function localAssignedKeys(dir, qctlEnv) {
  /** @type {string[]} */
  const order = []
  for (const name of ['.env.schema', `.env.${qctlEnv}`]) {
    const f = join(dir, name)
    if (!existsSync(f)) continue
    for (const key of listAssignedKeys(readFileSync(f, 'utf8'))) {
      if (key === 'QCTL_ENV') continue
      if (!order.includes(key)) order.push(key)
    }
  }
  return order
}

/**
 * Refuse package-root `.env.<env>` assignments of `@sensitive` keys (schema may
 * declare them via hub/root import so render can omit them; values belong in unit/).
 * @param {RenderEnv} renv
 * @param {string} pkgDir
 */
function assertPackageRootNoSensitive(renv, pkgDir) {
  const file = join(pkgDir, `.env.${renv.qctlEnv}`)
  if (!existsSync(file)) return
  for (const key of listAssignedKeys(readFileSync(file, 'utf8'))) {
    if (renv.sensitive.has(key)) {
      die(
        `${file}: @sensitive key ${key} must not be assigned in package-root env (use the unit folder + Secret=)`,
      )
    }
  }
}

/**
 * Repo-level render env when the repo root has a `.env.schema`.
 * @param {{ root: string, baseEnv: Scope, seedDir: string }} ctx
 * @returns {Promise<RenderEnv>}
 */
export async function loadRepoEnv(ctx) {
  const renv = seedRenderEnv(ctx, detectQctlEnv(ctx))
  if (existsSync(join(ctx.root, '.env.schema'))) await applyGraph(renv, ctx, ctx.root)
  return renv
}

/**
 * Package-root render env for Quadlet `${VAR}` substitution.
 * @param {{ root: string, baseEnv: Scope, seedDir: string }} ctx
 * @param {string} pkgDir applications/<app>
 * @returns {Promise<RenderEnv>}
 */
export async function loadRenderEnv(ctx, pkgDir) {
  const renv = seedRenderEnv(ctx, detectQctlEnv(ctx))
  if (existsSync(join(pkgDir, '.env.schema'))) {
    await applyGraph(renv, ctx, pkgDir)
    assertPackageRootNoSensitive(renv, pkgDir)
    renv.appEnvLabel = pkgDir
  } else if (
    listUnitDirs(pkgDir).length > 0
    || readdirSync(pkgDir).some((f) => f.startsWith('.env'))
  ) {
    die(`${pkgDir} has units/env files but no package-root .env.schema`)
  }
  return renv
}

/**
 * Network package render env: `networks/<n>/` directory graph when `.env.schema` exists,
 * otherwise the repo-root graph alone.
 * @param {{ root: string, baseEnv: Scope, seedDir: string }} ctx
 * @param {string} netFile absolute path to `.network` file
 * @returns {Promise<RenderEnv>}
 */
export async function loadNetworkRenderEnv(ctx, netFile) {
  const dir = dirname(netFile)
  if (existsSync(join(dir, '.env.schema'))) {
    return loadRenderEnv(ctx, dir)
  }
  return loadRepoEnv(ctx)
}

/**
 * Unit directories that should get an installed `EnvironmentFile=.env`.
 * @param {string} pkgDir
 * @returns {string[]}
 */
export function runtimeUnitDirs(pkgDir) {
  return listUnitDirs(pkgDir).filter((d) => existsSync(join(d, '.env.schema')))
}

/**
 * `${KEY}` substitution for the listed keys; error on anything left over.
 * @param {string} content
 * @param {RenderEnv} renv
 * @param {string} label
 * @returns {string}
 */
export function substitute(content, renv, label) {
  let out = content.replace(/\n+$/, '')
  for (const key of renv.substKeys) {
    out = out.split(`\${${key}}`).join(renv.scope[key] ?? '')
  }
  const left = out.match(UNRESOLVED_RE)
  if (left) {
    const uniq = [...new Set(left)].sort()
    die(
      `unresolved \${VAR} in render of ${label}:\n${uniq.join('\n')}\n`
        + 'hint: declare the key in the package-root .env.schema (or hub → root .env.dev/.env.prod)',
    )
  }
  return `${out}\n`
}

/**
 * Render a Quadlet/unit template file to a string.
 * @param {string} src
 * @param {RenderEnv} renv
 * @returns {string}
 */
export function renderFile(src, renv) {
  return substitute(readFileSync(src, 'utf8'), renv, src)
}

/**
 * systemd EnvironmentFile value: bare when safe, else double-quoted with `\\` / `"` escaped.
 * @param {string} value
 * @returns {string}
 */
export function envFileValue(value) {
  if (!/[\s"'\\]/.test(value)) return value
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`
}

/**
 * Render `EnvironmentFile=.env` content for a unit directory from its graph.
 * Only non-sensitive keys assigned in the unit's `.env.schema` / `.env.<env>`.
 *
 * @param {string} unitDir
 * @param {RenderEnv} packageRenv  used for qctlEnv / baseEnv identity; unit graph loaded fresh
 * @param {{ baseEnv: Scope }} ctx
 * @returns {Promise<string>}
 */
export async function renderUnitEnvFile(unitDir, packageRenv, ctx) {
  const graph = await loadEnvGraphForDir(unitDir, {
    env: ctx.baseEnv,
    qctlEnv: packageRenv.qctlEnv,
    skipSensitive: true,
    frozen: true,
  })
  const values = resolvedNonSensitive(graph, { includeInternal: false })
  const sensitive = sensitiveKeys(graph)
  const keys = localAssignedKeys(unitDir, packageRenv.qctlEnv)
  let out = ''
  for (const key of keys) {
    if (sensitive.has(key)) continue
    let value = values[key] ?? ''
    if (isPathKey(key) && value && !value.startsWith('/'))
      value = resolve(packageRenv.repoRoot, value)
    out += `${key}=${envFileValue(value)}\n`
  }
  return out
}
