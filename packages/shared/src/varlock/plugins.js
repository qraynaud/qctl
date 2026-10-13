/**
 * Varlock third-party plugins via instance `package.json` + `node_modules`.
 *
 * Varlock prefers `node_modules/<pkg>` (walk from the env file). The plugins-cache
 * / TTY-confirm path is unsuitable for non-self-contained plugins, so qctl installs
 * deps with `@npmcli/arborist` (no npm CLI required).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * @typedef {{ moduleName: string, version?: string, descriptor: string }} NpmPluginPin
 */

/** `# @plugin(name)` or `# @plugin(name@version)` — local paths skipped. */
const PLUGIN_RE = /#\s*@plugin\(\s*([^)\s]+)\s*\)/g

/**
 * Collect npm `# @plugin` refs from env-spec text (version optional; SoT is package.json).
 *
 * @param {string} text
 * @returns {NpmPluginPin[]}
 */
export function collectNpmPluginPins(text) {
  /** @type {Map<string, NpmPluginPin>} */
  const byModule = new Map()
  for (const match of text.matchAll(PLUGIN_RE)) {
    const raw = match[1]?.trim()
    if (!raw) continue
    if (raw.startsWith('.') || raw.startsWith('/') || raw.startsWith('file:')) continue
    const pin = parseNpmPluginRef(raw)
    if (!pin) continue
    const prev = byModule.get(pin.moduleName)
    // Prefer a versioned ref when both appear.
    if (!prev || (pin.version && !prev.version)) byModule.set(pin.moduleName, pin)
  }
  return [...byModule.values()]
}

/**
 * Scan a directory for `.env*` files and collect npm plugin refs.
 *
 * @param {string} dir
 * @returns {NpmPluginPin[]}
 */
export function collectNpmPluginPinsFromDir(dir) {
  /** @type {Map<string, NpmPluginPin>} */
  const byModule = new Map()
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  for (const name of names) {
    if (!name.startsWith('.env')) continue
    let text
    try {
      text = readFileSync(join(dir, name), 'utf8')
    } catch {
      continue
    }
    for (const pin of collectNpmPluginPins(text)) {
      const prev = byModule.get(pin.moduleName)
      if (!prev || (pin.version && !prev.version)) byModule.set(pin.moduleName, pin)
    }
  }
  return [...byModule.values()]
}

/**
 * Parse `# @plugin` npm ref: `name`, `@scope/name`, or `name@version` / `@scope/name@version`.
 *
 * @param {string} raw
 * @returns {NpmPluginPin | null}
 */
export function parseNpmPluginRef(raw) {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.startsWith('file:')) return null

  const at = trimmed.lastIndexOf('@')
  // Unversioned scoped (`@scope/name`) or unscoped (`name`).
  if (at <= 0) {
    if (trimmed.includes('..')) return null
    return { moduleName: trimmed, descriptor: trimmed }
  }

  const moduleName = trimmed.slice(0, at)
  const version = trimmed.slice(at + 1)
  if (!moduleName || !version || version.includes('/') || version.includes('..')) return null
  return { moduleName, version, descriptor: `${moduleName}@${version}` }
}

/**
 * Parse `name@version` only (scoped packages use the last `@`).
 *
 * @param {string} descriptor
 * @returns {NpmPluginPin | null}
 */
export function parseNpmPluginDescriptor(descriptor) {
  const pin = parseNpmPluginRef(descriptor)
  if (!pin?.version) return null
  return pin
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
 * Frozen install when `CI=true` or `QCTL_ENV` is set and not `dev`.
 *
 * @param {{ qctlEnv?: string, env?: Record<string, string | undefined> }} [opts]
 * @returns {boolean}
 */
export function shouldUseFrozenPackageInstall(opts = {}) {
  const env = opts.env ?? process.env
  if (String(env.CI ?? '') === 'true') return true
  const qctlEnv = opts.qctlEnv ?? env.QCTL_ENV ?? 'dev'
  return String(qctlEnv) !== 'dev'
}

/**
 * Install `package.json` deps into `node_modules` via Arborist (no npm CLI).
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
  /** @type {{ path: string, save?: boolean, packageLock?: boolean }} */
  const arbOpts = { path: pkgRoot }
  if (frozen) {
    arbOpts.save = false
    arbOpts.packageLock = true
  }
  const arb = new Arborist(arbOpts)
  await arb.reify(arbOpts)
}

/**
 * Ensure the nearest `package.json` above `startDir` has `node_modules` installed.
 * When `# @plugin(name)` / `# @plugin(name@version)` refs appear under `startDir`,
 * those packages must be listed in package.json dependencies (version SoT is the
 * lockfile; prefer unversioned `# @plugin(name)`).
 *
 * @param {string} startDir
 * @param {{
 *   skipInstall?: boolean,
 *   qctlEnv?: string,
 *   env?: Record<string, string | undefined>,
 *   frozen?: boolean,
 * }} [opts]
 * @returns {Promise<{ root: string | null, installed: boolean, frozen: boolean }>}
 */
export async function ensurePackageDependencies(startDir, opts = {}) {
  const pins = collectNpmPluginPinsFromDir(startDir)
  const pkgRoot = findPackageRoot(startDir)
  const frozen =
    opts.frozen === true || shouldUseFrozenPackageInstall({ qctlEnv: opts.qctlEnv, env: opts.env })

  if (!pkgRoot) {
    if (pins.length > 0) {
      const list = pins.map((p) => p.descriptor).join(', ')
      throw new Error(
        `varlock # @plugin requires a package.json above ${startDir} listing: ${list}\n`
          + '  Add those packages to dependencies, then re-run (qctl installs node_modules).',
      )
    }
    return { root: null, installed: false, frozen }
  }

  const declared = readPackageDependencyMap(pkgRoot)
  const missingDecl = pins.filter((p) => !(p.moduleName in declared))
  if (missingDecl.length > 0) {
    const list = missingDecl.map((p) => p.descriptor).join(', ')
    throw new Error(
      `package.json at ${pkgRoot} is missing dependencies for # @plugin pins: ${list}\n`
        + '  Add them under "dependencies", then re-run.',
    )
  }

  if (opts.skipInstall === true) {
    return { root: pkgRoot, installed: false, frozen }
  }

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
