/**
 * Load committable provision/<env>.yaml (+ optional <env>.<target>.yaml overlay).
 * Secret fields use YAML tag `!env VAR_NAME` and resolve from process.env or the
 * host env graph: prefer `provision/.env.schema` + `.env.<QCTL_ENV>` (+ `.env.local`),
 * else legacy root `.env.host`[+`.env.host.local`].
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse } from 'yaml'

import { deepMerge } from './merge.js'
import { GUEST_TAG, keysWithTag, loadEnvGraph, resolveEnvValuesPhased } from './varlock-graph.js'
/** @import { ScalarTag } from 'yaml' */
/** @import { YamlMapping, YamlValue } from './yaml.js' */

export const ENV_REF = Symbol.for('qctl.envRef')

/**
 * @typedef {object} EnvRef
 * @property {string} name
 */

/**
 * Unresolved provision node: YAML tree plus `!env` markers.
 *
 * @typedef {null | boolean | number | string | EnvRef | ProvisionValue[] | {
 *   [key: string]: ProvisionValue
 * }} ProvisionValue
 */

/** @typedef {{ [key: string]: ProvisionValue }} ProvisionMapping */

/**
 * @param {string} name
 * @returns {EnvRef}
 */
export function envRef(name) {
  return /** @type {EnvRef} */ ({ [ENV_REF]: true, name })
}

/**
 * @param {ProvisionValue} value
 * @returns {value is EnvRef}
 */
export function isEnvRef(value) {
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && /** @type {Record<PropertyKey, ProvisionValue>} */ (value)[ENV_REF] === true
    && typeof (/** @type {EnvRef} */ (value).name) === 'string'
  )
}

/** @type {ScalarTag} */
const envTag = {
  tag: '!env',
  resolve(value) {
    return envRef(String(value).trim())
  },
}

/**
 * @param {string} text
 * @param {string} [source]
 * @returns {ProvisionValue}
 */
export function parseProvisionYaml(text, source = '<yaml>') {
  try {
    return /** @type {ProvisionValue} */ (parse(text, { customTags: [envTag] }) ?? {})
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`invalid provision YAML ${source}: ${msg}`)
  }
}

/**
 * Collect `!env` names in document order (pre-order walk).
 * @param {ProvisionValue} value
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function collectEnvRefs(value, out = []) {
  if (isEnvRef(value)) {
    out.push(value.name)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEnvRefs(item, out)
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectEnvRefs(item, out)
  }
  return out
}

/**
 * Parse instance-root `.env.host` (KEY=value) for provision `!env` resolution.
 * Skips comments / blank lines; only non-empty values are returned.
 * Supports unquoted values and double-quoted strings with `\\n` / `\\"`.
 *
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
export function readEnvHostFile(filePath) {
  if (!existsSync(filePath)) return {}
  const text = readFileSync(filePath, 'utf8')
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let raw = trimmed.slice(eq + 1).trim()
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
      raw = raw.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    } else if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
      raw = raw.slice(1, -1)
    }
    if (raw === '') continue
    out[key] = raw
  }
  return out
}

/** @deprecated Prefer `provision/.env.schema` + `.env.<env>`; kept for migration. */
export const ENV_HOST_FILE = '.env.host'
/** @deprecated Prefer `provision/.env.local`. */
export const ENV_HOST_LOCAL_FILE = '.env.host.local'

/** Directory under the instance root for host/provision env + YAML. */
export const PROVISION_DIR = 'provision'

/**
 * Absolute paths for legacy `.env.host` then `.env.host.local` (only existing files).
 * @param {string} root
 * @returns {string[]}
 */
export function hostEnvFilePaths(root) {
  /** @type {string[]} */
  const paths = []
  for (const name of [ENV_HOST_FILE, ENV_HOST_LOCAL_FILE]) {
    const p = join(root, name)
    if (existsSync(p)) paths.push(p)
  }
  return paths
}

/**
 * Prefer `provision/.env.schema` (varlock dir + currentEnvFallback).
 * @param {string} root
 * @returns {string | null} absolute provision dir, or null
 */
export function provisionEnvDir(root) {
  const dir = join(root, PROVISION_DIR)
  return existsSync(join(dir, '.env.schema')) ? dir : null
}

/**
 * Merge `.env.host` then `.env.host.local` under `root` with `processEnv`
 * (non-empty process values win).
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [processEnv]
 * @returns {NodeJS.ProcessEnv}
 */
export function processEnvWithHostFile(root, processEnv = process.env) {
  /** @type {Record<string, string>} */
  const fromHost = {}
  for (const p of hostEnvFilePaths(root)) Object.assign(fromHost, readEnvHostFile(p))
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...fromHost }
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined && value !== '') env[key] = value
  }
  return env
}

/**
 * @param {ProvisionValue} value
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [path]
 * @returns {YamlValue}
 */
export function resolveEnvRefs(value, env, path = '') {
  if (isEnvRef(value)) {
    // Missing key → error. Empty string is allowed (optional provision slots).
    if (!(value.name in env)) {
      const where = path ? ` at ${path}` : ''
      throw new Error(
        `!env ${value.name}${where}: not set (fill provision/.env.<env>, export it, or provide via varlock)`,
      )
    }
    const raw = env[value.name]
    return raw === undefined || raw === null ? '' : String(raw)
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => resolveEnvRefs(item, env, `${path}[${i}]`))
  }
  if (value !== null && typeof value === 'object') {
    /** @type {YamlMapping} */
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      const child = path ? `${path}.${key}` : key
      out[key] = resolveEnvRefs(item, env, child)
    }
    return out
  }
  return value
}

/**
 * Drop the opposite hypervisor block after merge (local vs proxmox).
 * @param {YamlMapping | ProvisionMapping} data
 * @param {'local' | 'proxmox'} target
 */
export function stripOppositeTarget(data, target) {
  if (target === 'local') {
    delete data.proxmox
  } else {
    delete data.local
  }
}

/**
 * @typedef {object} LoadProvisionOptions
 * @property {string} root - instance repo root
 * @property {string} env - e.g. "dev"
 * @property {'local' | 'proxmox'} [target]
 * @property {NodeJS.ProcessEnv} [processEnv]
 * @property {boolean} [resolve] - resolve !env (default true)
 */

/**
 * @param {LoadProvisionOptions} opts
 * @returns {{
 *   data: ProvisionMapping,
 *   basePath: string,
 *   overlayPath: string | null,
 *   envRefs: string[],
 * }}
 */
export function loadProvisionDocument(opts) {
  const { root, env, target = 'local' } = opts

  const basePath = join(root, 'provision', `${env}.yaml`)
  if (!existsSync(basePath)) {
    throw new Error(`provision file not found: ${basePath}`)
  }

  const base = parseProvisionYaml(readFileSync(basePath, 'utf8'), basePath)
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    throw new Error(`${basePath}: expected a YAML mapping`)
  }

  /** @type {ProvisionMapping} */
  let data = { .../** @type {ProvisionMapping} */ (base) }

  const overlayPath = join(root, 'provision', `${env}.${target}.yaml`)
  /** @type {string | null} */
  let usedOverlay = null
  if (existsSync(overlayPath)) {
    const overlay = parseProvisionYaml(readFileSync(overlayPath, 'utf8'), overlayPath)
    data = /** @type {ProvisionMapping} */ (
      deepMerge(/** @type {YamlValue} */ (data), /** @type {YamlValue} */ (overlay))
    )
    usedOverlay = overlayPath
  }

  stripOppositeTarget(data, target)
  const envRefs = collectEnvRefs(data)
  return { data, basePath, overlayPath: usedOverlay, envRefs }
}

/**
 * @typedef {object} HostEnvLoad
 * @property {NodeJS.ProcessEnv} env  merged host + process env (non-empty process wins)
 * @property {Record<string, string>} guest  `@tag(guest)` keys with non-empty resolved values
 */

/**
 * Resolve host env for provision `!env` (and optional `@tag(guest)` extras).
 * Prefer `provision/.env.schema` + `.env.<QCTL_ENV>` (+ `.env.local`); else legacy
 * root `.env.host`[+`.env.host.local`].
 *
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [processEnv]
 * @returns {Promise<HostEnvLoad>}
 */
export async function loadHostEnvDetailed(root, processEnv = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const base = {}
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined && value !== '') base[key] = value
  }

  const qctlEnv = processEnv.QCTL_ENV || 'dev'
  const provDir = provisionEnvDir(root)

  /** @type {string[]} */
  let entryFilePaths = []
  /** @type {string} */
  let label = 'host env'

  if (provDir) {
    entryFilePaths = [provDir]
    const localPath = join(provDir, '.env.local')
    if (existsSync(localPath)) entryFilePaths.push(localPath)
    label = 'provision/.env'
  } else {
    entryFilePaths = hostEnvFilePaths(root)
    if (entryFilePaths.length === 0) return { env: base, guest: {} }
    const hostPath = join(root, ENV_HOST_FILE)
    const hostText = existsSync(hostPath) ? readFileSync(hostPath, 'utf8') : ''
    const hasVarlockHeader = hostText !== '' && /^#\s*---\s*$/m.test(hostText)
    if (!hasVarlockHeader) {
      /** @type {Record<string, string>} */
      const fromFiles = {}
      for (const p of entryFilePaths) Object.assign(fromFiles, readEnvHostFile(p))
      return { env: { ...fromFiles, ...base }, guest: {} }
    }
    label = '.env.host'
  }

  /** @type {Awaited<ReturnType<typeof loadEnvGraph>>} */
  let graph
  try {
    graph = await loadEnvGraph({
      entryFilePaths,
      currentEnvFallback: qctlEnv,
      overrideValues: { ...processEnv },
      processEnvOverride: { ...processEnv },
      skipCache: false,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`${label} graph load failed: ${msg}`)
  }

  /** @type {string[]} */
  const schemaErrs = []
  for (const src of graph.sortedDataSources) {
    for (const e of src.errors) if (!e.isWarning) schemaErrs.push(`${src.label}: ${e.message}`)
    for (const e of src.resolutionErrors) schemaErrs.push(`${src.label}: ${e.message}`)
  }
  if (!graph.configItemsProcessed || schemaErrs.length > 0) {
    throw new Error(`invalid ${label}:\n  ${schemaErrs.join('\n  ') || 'graph failed to load'}`)
  }

  try {
    await resolveEnvValuesPhased(graph)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`${label} resolve failed: ${msg}`)
  }

  /** @type {string[]} */
  const itemErrs = []
  /** @type {Record<string, string>} */
  const fromHost = {}
  for (const [key, item] of Object.entries(graph.configSchema)) {
    for (const e of item.errors) if (!e.isWarning) itemErrs.push(`${key}: ${e.message}`)
    const v = item.resolvedValue
    // Keep empty strings so optional `!env` slots resolve to "" instead of "not set".
    if (v !== undefined && v !== null) fromHost[key] = String(v)
  }
  if (itemErrs.length > 0) {
    throw new Error(`invalid ${label} values:\n  ${itemErrs.join('\n  ')}`)
  }

  const env = { ...fromHost, ...base }
  /** @type {Record<string, string>} */
  const guest = {}
  for (const key of keysWithTag(graph, GUEST_TAG)) {
    const v = env[key]
    if (v !== undefined && v !== '') guest[key] = String(v)
  }
  return { env, guest }
}

/**
 * Resolve `.env.host` then optional `.env.host.local` via the varlock graph
 * (supports `vw()`, `@plugin`, …). Falls back to KEY=value parsing when `.env.host`
 * has no `# ---` header (local still overlays).
 *
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [processEnv]
 * @returns {Promise<NodeJS.ProcessEnv>}
 */
export async function loadHostEnv(root, processEnv = process.env) {
  const { env } = await loadHostEnvDetailed(root, processEnv)
  return env
}

/**
 * Non-empty values for `# @tag(guest)` keys from `.env.host` / `.env.host.local`.
 * Used by `qctl vm seed` to embed Tier-0 pending credentials.
 *
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [processEnv]
 * @returns {Promise<Record<string, string>>}
 */
export async function loadHostGuestCredentials(root, processEnv = process.env) {
  const { guest } = await loadHostEnvDetailed(root, processEnv)
  return guest
}

/**
 * @typedef {object} LoadedProvision
 * @property {YamlMapping | ProvisionMapping} data
 * @property {string} basePath
 * @property {string | null} overlayPath
 * @property {string[]} envRefs
 */

/**
 * @param {LoadProvisionOptions} opts
 * @returns {Promise<LoadedProvision>}
 */
export async function loadProvision(opts) {
  const { processEnv = process.env, resolve = true } = opts
  const doc = loadProvisionDocument(opts)
  if (resolve && doc.envRefs.length > 0) {
    const merged = await loadHostEnv(opts.root, processEnv)
    return {
      ...doc,
      data: /** @type {YamlMapping} */ (resolveEnvRefs(doc.data, merged)),
    }
  }
  return doc
}

/**
 * True if a parsed (unresolved) provision document uses any `!env`.
 * @param {string} root
 * @param {string} env
 * @param {'local' | 'proxmox'} [target]
 */
export function provisionNeedsEnv(root, env, target = 'local') {
  const { envRefs } = loadProvisionDocument({ root, env, target })
  return envRefs.length > 0
}
