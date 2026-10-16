/**
 * Load provision YAML layers and resolve `!env`.
 *
 * Merge order (later wins; maps deep-merge, arrays replaced):
 *   common.yaml → <target>.yaml → <env>.yaml → <env>.<target>.yaml
 *
 * At least one of those four files must exist.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { deepMerge } from '../merge.js'
import { loadHostEnv } from './host-env.js'
import { collectEnvRefs, parseProvisionYaml, resolveEnvRefs, stripOppositeTarget } from './yaml.js'

/** @import { YamlMapping, YamlValue } from '../yaml.js' */
/** @import { ProvisionMapping } from './yaml.js' */

/** Shared foundation basename; reserved as env/profile name. */
export const COMMON_PROVISION = 'common'

/**
 * Target-layer basenames (`provision/<target>.yaml`); also reserved as env/profile names.
 * @type {ReadonlySet<string>}
 */
export const PROVISION_TARGETS = Object.freeze(new Set(['local', 'proxmox']))

/**
 * @typedef {object} LoadProvisionOptions
 * @property {string} root - instance repo root
 * @property {string} env - e.g. "dev"
 * @property {'local' | 'proxmox'} [target]
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
 *   overlayPath: string | null,
 *   envRefs: string[],
 * }}
 */
export function loadProvisionDocument(opts) {
  const { root, env, target = 'local' } = opts

  if (env === COMMON_PROVISION || PROVISION_TARGETS.has(env)) {
    throw new Error(
      `env "${env}" is reserved for provision/${env}.yaml `
        + '(layer basename); pick a different profile.env / QCTL_ENV',
    )
  }

  const provisionDir = join(root, 'provision')
  const commonCandidate = join(provisionDir, `${COMMON_PROVISION}.yaml`)
  const targetCandidate = join(provisionDir, `${target}.yaml`)
  const envCandidate = join(provisionDir, `${env}.yaml`)
  const overlayCandidate = join(provisionDir, `${env}.${target}.yaml`)

  /** @type {ProvisionMapping} */
  let data = {}
  const common = mergeIfPresent(data, commonCandidate)
  data = common.data
  const targetLayer = mergeIfPresent(data, targetCandidate)
  data = targetLayer.data
  const envLayer = mergeIfPresent(data, envCandidate)
  data = envLayer.data
  const overlay = mergeIfPresent(data, overlayCandidate)
  data = overlay.data

  if (!common.path && !targetLayer.path && !envLayer.path && !overlay.path) {
    throw new Error(
      `no provision YAML found for env=${env} target=${target} `
        + `(tried provision/{${COMMON_PROVISION},${target},${env},${env}.${target}}.yaml)`,
    )
  }

  stripOppositeTarget(data, target)
  const envRefs = collectEnvRefs(data)
  return {
    data,
    commonPath: common.path,
    targetPath: targetLayer.path,
    envPath: envLayer.path,
    overlayPath: overlay.path,
    envRefs,
  }
}

/**
 * @typedef {object} LoadedProvision
 * @property {YamlMapping | ProvisionMapping} data
 * @property {string | null} commonPath
 * @property {string | null} targetPath
 * @property {string | null} envPath
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
