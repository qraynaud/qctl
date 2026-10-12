/**
 * Provision YAML: `!env` tags, walk/collect, and resolve against an env map.
 */
import { parse } from 'yaml'

/** @import { ScalarTag } from 'yaml' */
/** @import { YamlMapping, YamlValue } from '../yaml.js' */

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
