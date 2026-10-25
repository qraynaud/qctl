/**
 * Load provision YAML layers and resolve `!env`.
 *
 * Merge order (later wins; maps deep-merge, arrays replaced):
 *   common.yaml → target-<target>.yaml → env-<env>.yaml → profile-<profile>.yaml
 *
 * Prefixes avoid basename collisions (env/profile keys need not be reserved).
 * At least one of those four files must exist.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { deepMerge } from '../merge.js'
import { loadHostEnv } from './host-env.js'
import { collectEnvRefs, parseProvisionYaml, resolveEnvRefs, stripOppositeTarget } from './yaml.js'

/** @import { YamlMapping, YamlValue } from '../yaml.js' */
/** @import { ProvisionMapping } from './yaml.js' */

/** Shared foundation basename (`provision/common.yaml`). */
export const COMMON_PROVISION = 'common'

/**
 * Valid hypervisor targets (`target` in profiles; file `target-<target>.yaml`).
 * @type {ReadonlySet<string>}
 */
export const PROVISION_TARGETS = Object.freeze(new Set(['workstation', 'proxmox']))

/**
 * @param {string} target
 * @returns {string} Basename under provision/
 */
export function provisionTargetFile(target) {
  return `target-${target}.yaml`
}

/**
 * @param {string} env
 * @returns {string}
 */
export function provisionEnvFile(env) {
  return `env-${env}.yaml`
}

/**
 * @param {string} profile
 * @returns {string}
 */
export function provisionProfileFile(profile) {
  return `profile-${profile}.yaml`
}

/**
 * @typedef {object} LoadProvisionOptions
 * @property {string} root - instance repo root
 * @property {string} env - e.g. "dev"
 * @property {string} [target] - driver module id (default workstation)
 * @property {string} profile - profile key (leaf layer `profile-<profile>.yaml`)
 * @property {Iterable<string>} [knownTargets] - overlay keys to strip besides `target`
 * @property {NodeJS.ProcessEnv} [processEnv]
 * @property {boolean} [resolve] - resolve !env (default true)
 */

/**
 * Parse a provision YAML file that must be a mapping.
 * @param {string} filePath
 * @returns {ProvisionMapping}
 */
function readProvisionMapping(filePath) {
  const parsed = parseProvisionYaml(readFileSync(filePath, 'utf8'), filePath)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${filePath}: expected a YAML mapping`)
  }
  return /** @type {ProvisionMapping} */ (parsed)
}

/**
 * Deep-merge `layer` onto `data` when `filePath` exists.
 * @param {ProvisionMapping} data
 * @param {string} filePath
 * @returns {{ data: ProvisionMapping, path: string | null }}
 */
function mergeIfPresent(data, filePath) {
  if (!existsSync(filePath)) return { data, path: null }
  return {
    data: /** @type {ProvisionMapping} */ (
      deepMerge(
        /** @type {YamlValue} */ (data),
        /** @type {YamlValue} */ (readProvisionMapping(filePath)),
      )
    ),
    path: filePath,
  }
}

/**
 * @param {LoadProvisionOptions} opts
 * @returns {{
 *   data: ProvisionMapping,
 *   commonPath: string | null,
 *   targetPath: string | null,
 *   envPath: string | null,
 *   profilePath: string | null,
 *   envRefs: string[],
 * }}
 */
export function loadProvisionDocument(opts) {
  const { root, env, target = 'workstation', profile, knownTargets } = opts
  if (!profile || !String(profile).trim()) {
    throw new Error('loadProvisionDocument: profile is required')
  }
  const profileKey = String(profile).trim()
  const targetId = String(target).trim() || 'workstation'

  const provisionDir = join(root, 'provision')
  const commonCandidate = join(provisionDir, `${COMMON_PROVISION}.yaml`)
  const targetCandidate = join(provisionDir, provisionTargetFile(targetId))
  const envCandidate = join(provisionDir, provisionEnvFile(env))
  const profileCandidate = join(provisionDir, provisionProfileFile(profileKey))

  /** @type {ProvisionMapping} */
  let data = {}
  const common = mergeIfPresent(data, commonCandidate)
  data = common.data
  const targetLayer = mergeIfPresent(data, targetCandidate)
  data = targetLayer.data
  const envLayer = mergeIfPresent(data, envCandidate)
  data = envLayer.data
  const profileLayer = mergeIfPresent(data, profileCandidate)
  data = profileLayer.data

  if (!common.path && !targetLayer.path && !envLayer.path && !profileLayer.path) {
    throw new Error(
      `no provision YAML found for profile=${profileKey} env=${env} target=${targetId} `
        + `(tried provision/{${COMMON_PROVISION}.yaml,${provisionTargetFile(targetId)},`
        + `${provisionEnvFile(env)},${provisionProfileFile(profileKey)}})`,
    )
  }

  stripOppositeTarget(data, targetId, knownTargets ?? PROVISION_TARGETS)
  const envRefs = collectEnvRefs(data)
  return {
    data,
    commonPath: common.path,
    targetPath: targetLayer.path,
    envPath: envLayer.path,
    profilePath: profileLayer.path,
    envRefs,
  }
}

/**
 * @typedef {object} LoadedProvision
 * @property {YamlMapping | ProvisionMapping} data
 * @property {string | null} commonPath
 * @property {string | null} targetPath
 * @property {string | null} envPath
 * @property {string | null} profilePath
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
 * @param {'workstation' | 'proxmox'} [target]
 * @param {string} [profile]
 */
export function provisionNeedsEnv(root, env, target = 'workstation', profile = 'lab') {
  const { envRefs } = loadProvisionDocument({ root, env, target, profile })
  return envRefs.length > 0
}
