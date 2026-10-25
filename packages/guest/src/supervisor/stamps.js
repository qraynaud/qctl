/**
 * App readiness stamps under `/run/qctl/app/<app>/`.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

import { QCTL_RUN_DIR_DEFAULT, appFailedPath, appReadyPath, appStampDir } from './paths.js'

/**
 * Ensure the supervisor runtime directory exists (mode 0755).
 * @param {string} [runDir]
 */
export function ensureRunDir(runDir = QCTL_RUN_DIR_DEFAULT) {
  mkdirSync(runDir, { recursive: true, mode: 0o755 })
}

/**
 * Mark app ready (world-readable so apps user can watch).
 * Clears any prior failed stamp.
 * @param {string} app
 * @param {string} [runDir]
 */
export function setAppReady(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  const dir = appStampDir(app, runDir)
  mkdirSync(dir, { recursive: true, mode: 0o755 })
  clearAppFailed(app, runDir)
  writeFileSync(appReadyPath(app, runDir), `${Date.now()}\n`, { encoding: 'utf8', mode: 0o644 })
}

/**
 * Clear ready stamp.
 * @param {string} app
 * @param {string} [runDir]
 */
export function clearAppReady(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  rmSync(appReadyPath(app, runDir), { force: true })
}

/**
 * Mark app failed (watching proxies exit non-zero).
 * Clears ready so Requires=/BindsTo= dependents tear down.
 * @param {string} app
 * @param {string} [runDir]
 */
export function setAppFailed(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  const dir = appStampDir(app, runDir)
  mkdirSync(dir, { recursive: true, mode: 0o755 })
  rmSync(appReadyPath(app, runDir), { force: true })
  writeFileSync(appFailedPath(app, runDir), `${Date.now()}\n`, { encoding: 'utf8', mode: 0o644 })
}

/**
 * @param {string} app
 * @param {string} [runDir]
 */
function clearAppFailed(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  rmSync(appFailedPath(app, runDir), { force: true })
}

/**
 * @param {string} app
 * @param {string} [runDir]
 * @returns {boolean}
 */
export function isAppReady(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  return existsSync(appReadyPath(app, runDir))
}

/**
 * @param {string} app
 * @param {string} [runDir]
 * @returns {boolean}
 */
export function isAppFailed(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  return existsSync(appFailedPath(app, runDir))
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      return
    }
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      },
      { once: true },
    )
  })
}

/**
 * Poll until ready (or failed / timeout / abort).
 * @param {string} app
 * @param {{
 *   runDir?: string,
 *   timeoutMs?: number,
 *   pollMs?: number,
 *   signal?: AbortSignal,
 * }} [opts]
 * @returns {Promise<'ready' | 'failed'>}
 */
export async function waitAppReady(app, opts = {}) {
  const runDir = opts.runDir ?? QCTL_RUN_DIR_DEFAULT
  const timeoutMs = opts.timeoutMs ?? 60_000
  const pollMs = opts.pollMs ?? 100
  const deadline = Date.now() + timeoutMs

  while (true) {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
    if (isAppFailed(app, runDir)) return 'failed'
    if (isAppReady(app, runDir)) return 'ready'
    if (Date.now() >= deadline) {
      throw new Error(`qctl-app proxy: timeout waiting for ready stamp (${app})`)
    }
    await sleep(pollMs, opts.signal)
  }
}

/**
 * After ready: poll until ready is gone or failed appears.
 * @param {string} app
 * @param {{
 *   runDir?: string,
 *   pollMs?: number,
 *   signal?: AbortSignal,
 * }} [opts]
 * @returns {Promise<'cleared' | 'failed'>}
 */
export async function watchAppUntilNotReady(app, opts = {}) {
  const runDir = opts.runDir ?? QCTL_RUN_DIR_DEFAULT
  const pollMs = opts.pollMs ?? 200

  while (true) {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
    if (isAppFailed(app, runDir)) return 'failed'
    if (!isAppReady(app, runDir)) return 'cleared'
    await sleep(pollMs, opts.signal)
  }
}
