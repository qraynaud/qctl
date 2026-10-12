/**
 * Host provision env: `provision/.env.schema` + `.env.<QCTL_ENV>` (+ `.env.local`).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { GUEST_TAG, keysWithTag, loadEnvGraph } from '../varlock-graph.js'

/** Directory under the instance root for host/provision env + YAML. */
export const PROVISION_DIR = 'provision'

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
 * @typedef {object} HostEnvLoad
 * @property {NodeJS.ProcessEnv} env  merged host + process env (non-empty process wins)
 * @property {Record<string, string>} guest  `@tag(guest)` keys with non-empty resolved values
 */

/**
 * Resolve host env for provision `!env` (and optional `@tag(guest)` extras)
 * from `provision/.env.schema` + `.env.<QCTL_ENV>` (+ `.env.local`).
 * When the provision schema is missing, returns process env only (no guest tags).
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
  if (!provDir) {
    return { env: base, guest: {} }
  }

  /** @type {string[]} */
  const entryFilePaths = [provDir]
  const localPath = join(provDir, '.env.local')
  if (existsSync(localPath)) entryFilePaths.push(localPath)
  const label = 'provision/.env'

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
    await graph.resolveEnvValues()
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
 * Resolve provision host env via the varlock graph (`vw()`, `@plugin`, …).
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
 * Non-empty values for `# @tag(guest)` keys from `provision/.env.*`.
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
