/**
 * Provision YAML: `!env` tags, walk/collect, and resolve against an env map.
 *
 * Forms:
 *   !env NAME
 *   !env { name: NAME, encoding: base64 }
 *
 * Resolve → `Buffer.from(env[name], encoding)` (default encoding `utf8`).
 */
import { parse } from 'yaml'

/** @import { CollectionTag, ScalarTag } from 'yaml' */
/** @import { YamlMapping, YamlValue } from '../yaml.js' */

export const ENV_REF = Symbol.for('qctl.envRef')

/** @typedef {'utf8' | 'base64' | 'hex' | 'latin1' | 'ascii'} EnvEncoding */

/**
 * @typedef {object} EnvRef
 * @property {string} name
 * @property {EnvEncoding} encoding
 */

/**
 * Unresolved provision node: YAML tree plus `!env` markers.
 *
 * @typedef {null | boolean | number | string | EnvRef | ProvisionValue[] | {
 *   [key: string]: ProvisionValue
 * }} ProvisionValue
 */

/** @typedef {{ [key: string]: ProvisionValue }} ProvisionMapping */

/** @type {ReadonlySet<string>} */
const ENV_ENCODINGS = new Set(['utf8', 'base64', 'hex', 'latin1', 'ascii'])

/**
 * @param {string} name
 * @param {string} [encoding]
 * @returns {EnvRef}
 */
export function envRef(name, encoding = 'utf8') {
  const enc = normalizeEnvEncoding(encoding)
  return /** @type {EnvRef} */ ({ [ENV_REF]: true, name, encoding: enc })
}

/**
 * @param {string} encoding
 * @param {string} [where]
 * @returns {EnvEncoding}
 */
function normalizeEnvEncoding(encoding, where = '') {
  const enc =
    String(encoding || 'utf8')
      .trim()
      .toLowerCase() || 'utf8'
  if (!ENV_ENCODINGS.has(enc)) {
    const suffix = where ? ` ${where}` : ''
    throw new Error(
      `!env encoding ${JSON.stringify(encoding)}${suffix}: must be one of ${[...ENV_ENCODINGS].join(', ')}`,
    )
  }
  return /** @type {EnvEncoding} */ (enc)
}

/**
 * @param {ProvisionValue | YamlValue | null | undefined} value
 * @returns {value is EnvRef}
 */
export function isEnvRef(value) {
  return (
    value != null
    && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof Uint8Array)
    && /** @type {Record<PropertyKey, ProvisionValue>} */ (value)[ENV_REF] === true
    && typeof (/** @type {EnvRef} */ (value).name) === 'string'
  )
}

/**
 * True when a resolved credential / YAML scalar is missing or empty.
 *
 * @param {YamlValue | null | undefined} value
 * @returns {boolean}
 */
export function isEmptyCredential(value) {
  if (value == null) return true
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.length === 0
  if (value instanceof Uint8Array) return value.length === 0
  if (typeof value === 'string') return value === ''
  if (typeof value === 'number' || typeof value === 'boolean') return false
  return false
}

/** @type {ScalarTag} */
const envScalarTag = {
  tag: '!env',
  resolve(value) {
    return envRef(String(value).trim())
  },
}

/** @type {CollectionTag} */
const envMapTag = {
  tag: '!env',
  collection: 'map',
  resolve(map, onError) {
    const obj = /** @type {Record<string, string | number | boolean | null | undefined>} */ (
      map.toJSON()
    )
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      onError('!env mapping must be a plain mapping with name (and optional encoding)')
      return envRef('')
    }
    const name = String(obj.name ?? '').trim()
    if (!name) {
      onError('!env mapping requires a non-empty name')
      return envRef('')
    }
    try {
      const encoding = obj.encoding == null || obj.encoding === '' ? 'utf8' : String(obj.encoding)
      return envRef(name, encoding)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      return envRef(name)
    }
  },
}

/**
 * @param {string} text
 * @param {string} [source]
 * @returns {ProvisionValue}
 */
export function parseProvisionYaml(text, source = '<yaml>') {
  try {
    return /** @type {ProvisionValue} */ (
      parse(text, { customTags: [envScalarTag, envMapTag] }) ?? {}
    )
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
  if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) {
    for (const item of Object.values(value)) collectEnvRefs(item, out)
  }
  return out
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
    const s = raw === undefined || raw === null ? '' : String(raw)
    const encoding = value.encoding || 'utf8'
    try {
      return Buffer.from(s, encoding)
    } catch (err) {
      const where = path ? ` at ${path}` : ''
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`!env ${value.name}${where}: cannot decode as ${encoding} (${detail})`)
    }
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => resolveEnvRefs(item, env, `${path}[${i}]`))
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) {
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
 * Drop the opposite hypervisor block after merge (workstation vs proxmox).
 * @param {YamlMapping | ProvisionMapping} data
 * @param {'workstation' | 'proxmox'} target
 */
export function stripOppositeTarget(data, target) {
  if (target === 'workstation') {
    delete data.proxmox
  } else {
    delete data.workstation
  }
}
