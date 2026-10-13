/**
 * Host provision env: `provision/.env.schema` + `.env.<QCTL_ENV>` (+ `.env.local`).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { GUEST_TAG, keysWithTag, loadEnvGraphForDir } from '../varlock/index.js'

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
 * Plugin install: same one-shot reify-on-unresolved-plugin path as `loadEnvGraphForDir`.
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

  const localPath = join(provDir, '.env.local')
  /** @type {Awaited<ReturnType<typeof loadEnvGraphForDir>>} */
  const graph = await loadEnvGraphForDir(provDir, {
    env: /** @type {Record<string, string | undefined>} */ (processEnv),
    qctlEnv,
    extraEntryPaths: existsSync(localPath) ? [localPath] : [],
  })

  /** @type {Record<string, string>} */
  const fromHost = {}
  for (const [key, item] of Object.entries(graph.configSchema)) {
    const v = item.resolvedValue
    // Keep empty strings so optional `!env` slots resolve to "" instead of "not set".
    if (v !== undefined && v !== null) fromHost[key] = String(v)
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
