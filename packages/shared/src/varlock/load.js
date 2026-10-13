import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { loadEnvGraph } from './builtins.js'
import { hydrateSystemdCredentials } from './hydrate.js'
import { ensurePackageDependencies, isVarlockUnresolvedPluginError } from './plugins.js'
import { keysWithTag } from './project.js'
import { declaresSensitive } from './sensitivity.js'
import { GUEST_TAG } from './tags.js'

/** @import { EnvGraph } from './builtins.js' */

/**
 * @typedef {object} LoadGraphOptions
 * @property {Record<string, string | undefined>} [env]  base process env (default `process.env`)
 * @property {string} [qctlEnv]  `currentEnvFallback` + exported as `QCTL_ENV` for hub `enabled=`
 * @property {string[]} [extraEntryPaths]  additional absolute entry files
 * @property {boolean} [skipSensitive]  resolve only items without an explicit `@sensitive`
 *                               decorator (plus their dependencies): never runs `vw()` & co.
 *                               Quadlet render path — mark template keys `@public` so they
 *                               appear in `resolvedNonSensitive` after resolve.
 * @property {boolean} [skipCache]
 *   when true, disable varlock encrypted cache (default false so `@initVw`
 *   interactive unlock can persist `sessionTtl` like official `@initBwp`).
 * @property {boolean} [skipPluginEnsure]
 *   when true, skip one-shot package.json reify after a missing-plugin schema error.
 */

/**
 * @param {unknown} err caught value (catch edge — narrowed to Error here)
 * @returns {string}
 */
function errMessage(err) {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Hard problems in the schema files themselves (parse/import/plugin/decorator errors).
 * @param {EnvGraph} graph
 * @returns {string[]}
 */
function schemaErrorLines(graph) {
  /** @type {string[]} */
  const lines = []
  for (const src of graph.sortedDataSources) {
    for (const e of src.errors) if (!e.isWarning) lines.push(`${src.label}: ${e.message}`)
    for (const e of src.resolutionErrors) lines.push(`${src.label}: ${e.message}`)
  }
  return lines
}

/**
 * Per-item resolution/validation errors (warnings excluded), `KEY: message`.
 * @param {EnvGraph} graph
 * @param {boolean} [skipSensitive] ignore items that were deliberately left unresolved
 * @returns {string[]}
 */
function itemErrorLines(graph, skipSensitive = false) {
  /** @type {string[]} */
  const lines = []
  for (const [key, item] of Object.entries(graph.configSchema)) {
    if (skipSensitive && declaresSensitive(item)) continue
    for (const e of item.errors) if (!e.isWarning) lines.push(`${key}: ${e.message}`)
  }
  return lines
}

/**
 * After resolve: `@tag(guest)` + `@required` items must be non-empty.
 * Optional guest keys stay empty when `$CREDENTIALS_DIRECTORY` is absent
 * (e.g. rootless day-2 sync using a cached VW session).
 * @param {EnvGraph} graph
 * @returns {string[]}
 */
function missingGuestCredentialLines(graph) {
  /** @type {string[]} */
  const lines = []
  for (const key of keysWithTag(graph, GUEST_TAG)) {
    const item = graph.configSchema[key]
    if (!item?.isRequired) continue
    const v = item.resolvedValue
    const s = v === undefined || v === null ? '' : String(v)
    if (!s) {
      lines.push(
        `${key}: @tag(${GUEST_TAG}) @required empty — need LoadCredentialEncrypted=${key} `
          + `(file in $CREDENTIALS_DIRECTORY) or export ${key}`,
      )
    }
  }
  return lines
}

/**
 * @param {EnvGraph} graph
 * @param {string[]} [onlyKeys]  when set, only these keys (+ their deps) are resolved
 * @returns {Promise<void>}
 */
async function resolveEnvValues(graph, onlyKeys) {
  if (onlyKeys) {
    await graph.resolveEnvValues([...graph.expandKeysWithTransitiveDeps(onlyKeys)])
    return
  }
  await graph.resolveEnvValues()
}

/**
 * @param {EnvGraph} graph
 * @returns {string | null} joined schema error text, or null when graph is usable
 */
function schemaFailureBlob(graph) {
  const schemaErrs = schemaErrorLines(graph)
  if (graph.configItemsProcessed && schemaErrs.length === 0) return null
  return schemaErrs.join('\n') || 'graph failed to load'
}

/**
 * Load + resolve the varlock graph for a schema directory.
 *
 * Entry = the directory itself (`currentEnvFallback` autoloads `.env.<env>`). Optional
 * `extraEntryPaths` are appended.
 *
 * On varlock’s unresolved-plugin schema error, reifies `package.json` **once** and
 * reloads (no loop).
 *
 * Throws on schema errors and on any item resolution/validation error.
 *
 * @param {string} dir
 * @param {LoadGraphOptions} [opts]
 * @returns {Promise<EnvGraph>}
 */
export async function loadEnvGraphForDir(dir, opts = {}) {
  const base = opts.env ?? process.env
  const qctlEnv = opts.qctlEnv ?? base.QCTL_ENV ?? 'dev'
  /** @type {Record<string, string | undefined>} */
  const overrideValues = { ...base }
  overrideValues.QCTL_ENV = qctlEnv
  hydrateSystemdCredentials(overrideValues)

  if (!existsSync(join(dir, '.env.schema'))) throw new Error(`no .env.schema in ${dir}`)

  const extra = opts.extraEntryPaths ?? []

  /**
   * @returns {Promise<EnvGraph>}
   */
  async function loadOnce() {
    try {
      return await loadEnvGraph({
        entryFilePaths: [dir, ...extra],
        currentEnvFallback: qctlEnv,
        overrideValues,
        processEnvOverride: overrideValues,
        skipCache: opts.skipCache === true,
      })
    } catch (err) {
      throw new Error(`varlock graph load failed for ${dir}: ${errMessage(err)}`)
    }
  }

  /** @type {EnvGraph} */
  let graph = await loadOnce()
  let failBlob = schemaFailureBlob(graph)

  if (failBlob && opts.skipPluginEnsure !== true && isVarlockUnresolvedPluginError(failBlob)) {
    try {
      await ensurePackageDependencies(dir, { qctlEnv, env: base })
    } catch (err) {
      throw new Error(`varlock plugin ensure failed for ${dir}: ${errMessage(err)}`)
    }
    graph = await loadOnce()
    failBlob = schemaFailureBlob(graph)
  }

  if (failBlob) {
    throw new Error(`invalid schema in ${dir}:\n  ${failBlob.split('\n').join('\n  ')}`)
  }

  try {
    if (opts.skipSensitive) {
      // Pre-resolve, varlock still reports default sensitivity; use explicit @sensitive.
      const keys = Object.entries(graph.configSchema)
        .filter(([, item]) => !declaresSensitive(item))
        .map(([key]) => key)
      await resolveEnvValues(graph, keys)
    } else {
      await resolveEnvValues(graph)
    }
  } catch (err) {
    throw new Error(`varlock resolve failed for ${dir}: ${errMessage(err)}`)
  }

  const errs = itemErrorLines(graph, opts.skipSensitive)
  if (!opts.skipSensitive) errs.push(...missingGuestCredentialLines(graph))
  if (errs.length > 0) throw new Error(`invalid schema values in ${dir}:\n  ${errs.join('\n  ')}`)
  return graph
}
