/**
 * Varlock third-party plugins via instance `package.json` + `node_modules`.
 *
 * Varlock prefers `node_modules/<pkg>` (walk from the env file). The plugins-cache
 * / TTY-confirm path is unsuitable for non-self-contained plugins, so qctl installs
 * deps with `@npmcli/arborist` (no npm CLI required).
 *
 * Graph loads do not scan `# @plugin` (imports are varlock’s job). On varlock’s
 * “unable to resolve — install locally via package.json” error, ensure reifies once
 * and the load is retried.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { BUILTIN_ENVIRONMENTS, isProductionEnv } from '../provision/production.js'

/**
 * Distinctive varlock message when a `# @plugin` package is not in node_modules.
 * Keep in sync with a real load failure — see plugins.test.js.
 */
export const VARLOCK_UNRESOLVED_PLUGIN_RE =
  /Plugin "[^"]+" unable to resolve - install locally via your package\.json file/

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isVarlockUnresolvedPluginError(text) {
  return VARLOCK_UNRESOLVED_PLUGIN_RE.test(text)
}

/**
 * Walk `startDir` and parents for a `package.json` (instance root).
 *
 * @param {string} startDir
 * @returns {string | null} directory containing package.json
 */
export function findPackageRoot(startDir) {
  let current = startDir
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * @param {string} pkgRoot
 * @returns {Record<string, string>}
 */
export function readPackageDependencyMap(pkgRoot) {
  const raw = readFileSync(join(pkgRoot, 'package.json'), 'utf8')
  /** @type {{ dependencies?: Record<string, string>, optionalDependencies?: Record<string, string> }} */
  let pkg
  try {
    pkg = JSON.parse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`invalid package.json in ${pkgRoot}: ${msg}`)
  }
  return { ...(pkg.optionalDependencies ?? {}), ...(pkg.dependencies ?? {}) }
}

/**
 * @param {string} pkgRoot
 * @param {string} moduleName
 * @returns {boolean}
 */
export function isPackageInstalled(pkgRoot, moduleName) {
  return existsSync(join(pkgRoot, 'node_modules', ...moduleName.split('/')))
}

/**
 * True when every `dependencies` / `optionalDependencies` entry is present under node_modules.
 *
 * @param {string} pkgRoot
 * @returns {boolean}
 */
export function packageDepsSatisfied(pkgRoot) {
  const deps = readPackageDependencyMap(pkgRoot)
  for (const name of Object.keys(deps)) {
    if (!isPackageInstalled(pkgRoot, name)) return false
  }
  return true
}

/**
 * Frozen install when `CI=true` or the active env is marked `production: true`.
 *
 * @param {{
 *   qctlEnv?: string,
 *   env?: Record<string, string | undefined>,
 *   environments?: Record<string, { production?: boolean }>,
 *   production?: boolean,
 * }} [opts]
 * @returns {boolean}
 */
export function shouldUseFrozenPackageInstall(opts = {}) {
  const env = opts.env ?? process.env
  if (String(env.CI ?? '') === 'true') return true
  if (opts.production === true) return true
  if (opts.production === false) return false
  const qctlEnv = String(opts.qctlEnv ?? env.QCTL_ENV ?? 'dev')
  return isProductionEnv(qctlEnv, opts.environments ?? BUILTIN_ENVIRONMENTS)
}

/**
 * Install `package.json` production deps into `node_modules` via Arborist (no npm CLI).
 * Always omits `devDependencies` (`omit: ['dev']`, like `npm i --omit=dev`).
 * Frozen mode requires `package-lock.json` and does not rewrite it (`save: false`).
 *
 * @param {string} pkgRoot
 * @param {{ frozen?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function installPackageDependencies(pkgRoot, opts = {}) {
  const frozen = opts.frozen === true
  const lockPath = join(pkgRoot, 'package-lock.json')
  if (frozen && !existsSync(lockPath)) {
    throw new Error(
      `frozen install requires package-lock.json in ${pkgRoot}\n`
        + '  Run a non-frozen install with QCTL_ENV=dev (and CI unset) to generate it, then commit the lockfile.',
    )
  }

  const { Arborist } = await import('@npmcli/arborist')
  /** @typedef {'dev' | 'optional' | 'prod' | 'peerOptional' | 'peer'} ArboristOmit */
  /** @type {{ path: string, omit: ArboristOmit[], save?: boolean, packageLock?: boolean }} */
  const arbOpts = { path: pkgRoot, omit: ['dev'] }
  if (frozen) {
    arbOpts.save = false
    arbOpts.packageLock = true
  }
  const arb = new Arborist(arbOpts)
  await arb.reify(arbOpts)
}

/**
 * Ensure the nearest `package.json` above `startDir` has `node_modules` installed
 * when declared dependencies are missing. No `# @plugin` scanning — package.json is SoT.
 *
 * @param {string} startDir
 * @param {{
 *   skipInstall?: boolean,
 *   qctlEnv?: string,
 *   env?: Record<string, string | undefined>,
 *   environments?: Record<string, { production?: boolean }>,
 *   production?: boolean,
 *   frozen?: boolean,
 * }} [opts]
 * @returns {Promise<{ root: string | null, installed: boolean, frozen: boolean }>}
 */
export async function ensurePackageDependencies(startDir, opts = {}) {
  const pkgRoot = findPackageRoot(startDir)
  const frozen =
    opts.frozen === true
    || shouldUseFrozenPackageInstall({
      qctlEnv: opts.qctlEnv,
      env: opts.env,
      environments: opts.environments,
      production: opts.production,
    })

  if (!pkgRoot) {
    return { root: null, installed: false, frozen }
  }

  if (opts.skipInstall === true) {
    return { root: pkgRoot, installed: false, frozen }
  }

  const declared = readPackageDependencyMap(pkgRoot)
  if (Object.keys(declared).length === 0) {
    return { root: pkgRoot, installed: false, frozen }
  }

  if (packageDepsSatisfied(pkgRoot)) {
    return { root: pkgRoot, installed: false, frozen }
  }

  try {
    await installPackageDependencies(pkgRoot, { frozen })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`npm install failed for ${pkgRoot}: ${msg}`)
  }
  return { root: pkgRoot, installed: true, frozen }
}
