/**
 * Load `provision/<env>.yaml` (+ optional target overlay) and resolve `!env`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { deepMerge } from '../merge.js'
import { loadHostEnv } from './host-env.js'
import { collectEnvRefs, parseProvisionYaml, resolveEnvRefs, stripOppositeTarget } from './yaml.js'

/** @import { YamlMapping, YamlValue } from '../yaml.js' */
/** @import { ProvisionMapping } from './yaml.js' */

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
