import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { die } from '../errors.js'
import { QUADLET_EXTS, SYSTEMD_EXTS } from './constants.js'

/** @import { Engine } from '../system.js' */

const DEP_EXTS = ['container', 'pod', 'kube', 'volume', 'network', 'build', 'image']

/**
 * Files in `dir` matching each extension in order (like `*.{a,b}`), each group sorted.
 * @param {string} dir
 * @param {readonly string[]} exts
 * @returns {string[]} absolute paths
 */
export function globExts(dir, exts) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  /** @type {string[]} */
  const out = []
  for (const ext of exts) {
    for (const n of names
      .filter((x) => x.endsWith(`.${ext}`) && x.length > ext.length + 1)
      .sort()) {
      const p = join(dir, n)
      try {
        if (statSync(p).isFile()) out.push(p)
      } catch {
        // dangling
      }
    }
  }
  return out
}

/**
 * Unit subdirectories of a package: immediate children that contain a `*.container`.
 * @param {string} pkgDir applications/<app>
 * @returns {string[]} absolute paths, sorted by basename
 */
export function listUnitDirs(pkgDir) {
  let names
  try {
    names = readdirSync(pkgDir)
  } catch {
    return []
  }
  /** @type {string[]} */
  const out = []
  for (const n of names.sort()) {
    const d = join(pkgDir, n)
    try {
      if (!statSync(d).isDirectory()) continue
    } catch {
      continue
    }
    if (globExts(d, ['container']).length > 0) out.push(d)
  }
  return out
}

/**
 * All Quadlet/systemd unit files for a package: package-root (shared) then each unit dir (private).
 * @param {string} pkgDir
 * @param {readonly string[]} exts
 * @returns {string[]} absolute paths
 */
export function packageUnitFiles(pkgDir, exts) {
  /** @type {string[]} */
  const out = [...globExts(pkgDir, exts)]
  for (const udir of listUnitDirs(pkgDir)) {
    out.push(...globExts(udir, exts))
  }
  return out
}

/**
 * Install subdirectory name for a unit (basename of the unit folder).
 * @param {string} unitDir
 * @returns {string}
 */
export function unitInstallName(unitDir) {
  return basename(unitDir)
}

/**
 * @param {{ root: string }} ctx
 * @param {string} name
 * @returns {string | null} applications/<name> when it has app.yaml
 */
export function appDir(ctx, name) {
  const d = join(ctx.root, 'applications', name)
  return existsSync(join(d, 'app.yaml')) ? d : null
}

/**
 * @param {{ root: string }} ctx
 * @returns {string[]}
 */
export function listRepoApps(ctx) {
  const base = join(ctx.root, 'applications')
  let names
  try {
    names = readdirSync(base)
  } catch {
    return []
  }
  return names.filter((n) => existsSync(join(base, n, 'app.yaml'))).sort()
}

/**
 * @typedef {object} AppYaml
 * @property {string} [engine]
 * @property {string | string[]} [companions]
 */

/**
 * @param {string} dir
 * @returns {AppYaml}
 */
function readAppYaml(dir) {
  const file = join(dir, 'app.yaml')
  const doc = parseYaml(readFileSync(file, 'utf8'))
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? /** @type {AppYaml} */ (doc) : {}
}

/**
 * @param {string} dir
 * @returns {Engine}
 */
export function readEngine(dir) {
  const e = readAppYaml(dir).engine
  if (e === undefined || e === null || e === '') die(`missing engine: in ${join(dir, 'app.yaml')}`)
  if (e !== 'rootless' && e !== 'rootful')
    die(`unknown engine '${String(e)}' in ${join(dir, 'app.yaml')}`)
  return e
}

/**
 * Cross-engine/soft companions from app.yaml (`companions: [ … ]`).
 * @param {string} dir
 * @returns {string[]}
 */
export function companionApps(dir) {
  if (!existsSync(join(dir, 'app.yaml'))) return []
  const c = readAppYaml(dir).companions
  if (!Array.isArray(c)) return []
  return c.map((x) => String(x).trim()).filter(Boolean)
}

const DEP_LINE_RE = /^(After|Wants|Requires|Requisite|BindsTo|PartOf|Upholds)=(.*)$/

/**
 * Other applications referenced via After=/Wants=/Requires=/… *.service in this app's units.
 * @param {{ root: string }} ctx
 * @param {string} dir
 * @returns {string[]} sorted unique
 */
export function unitDepApps(ctx, dir) {
  /** @type {Set<string>} */
  const out = new Set()
  for (const f of packageUnitFiles(dir, DEP_EXTS)) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = DEP_LINE_RE.exec(line)
      if (!m) continue
      const val = (m[2] ?? '').split('#')[0] ?? ''
      for (const unit of val.split(/\s+/).filter(Boolean)) {
        if (!unit.endsWith('.service')) continue
        const app = unit.slice(0, -'.service'.length)
        if (appDir(ctx, app)) out.add(app)
      }
    }
  }
  return [...out].sort()
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
export function appHasUnits(dir) {
  return packageUnitFiles(dir, [...QUADLET_EXTS, ...SYSTEMD_EXTS]).length > 0
}

/**
 * Normalize `vaultwarden | applications/vaultwarden | /abs/path` → basename.
 * @param {string} arg
 * @returns {string}
 */
export function resolveAppName(arg) {
  const a = arg.replace(/\/+$/, '')
  if (a.startsWith('common/') || a.includes('/common/')) {
    die(`common/ is libraries, not apps (got ${arg})`)
  }
  return a.includes('/') ? basename(a) : a
}

/**
 * systemd service/timer names for an app's units (containers, pods, kubes, timers, services).
 * @param {string} dir
 * @returns {string[]}
 */
export function appServiceNames(dir) {
  /** @type {string[]} */
  const out = []
  for (const f of packageUnitFiles(dir, ['container', 'pod', 'kube'])) {
    out.push(`${basename(f).replace(/\.[^.]*$/, '')}.service`)
  }
  for (const f of packageUnitFiles(dir, ['timer'])) out.push(basename(f))
  for (const f of packageUnitFiles(dir, ['service'])) out.push(basename(f))
  return out
}

/**
 * First `key=value` line of a unit template (`ContainerName`, `Image`, …).
 * @param {string} file
 * @param {string} key
 * @returns {string}
 */
export function unitValue(file, key) {
  const prefix = `${key}=`
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith(prefix)) return line.slice(prefix.length)
  }
  return ''
}

/**
 * @param {string} file .container template path
 * @returns {string}
 */
export function containerName(file) {
  return unitValue(file, 'ContainerName') || basename(file, '.container')
}
