/**
 * `qctl-app@` proxy process: ensure → wait ready → sd_notify → watch; --release.
 */

import { SupervisorUnavailableError, supervisorRequest } from './client.js'
import { QCTL_RUN_DIR_DEFAULT, appsSockPath } from './paths.js'
import { sdNotify } from './sd-notify.js'
import { waitAppReady } from './stamps.js'

/** Systemd template instance charset (app dir names must match). */
const APP_INSTANCE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/

/**
 * @param {string} app
 * @returns {string}
 */
export function assertProxyAppName(app) {
  const name = app.trim()
  if (!name || !APP_INSTANCE_RE.test(name)) {
    throw new Error(`qctl-app proxy: invalid app instance name '${app}'`)
  }
  return name
}

/**
 * @param {{
 *   app: string,
 *   runDir?: string,
 *   sockPath?: string,
 *   signal?: AbortSignal,
 *   readyTimeoutMs?: number,
 *   notify?: typeof sdNotify,
 *   request?: typeof supervisorRequest,
 *   exitProcess?: boolean,
 *   log?: (line: string) => void,
 * }} opts
 * @returns {Promise<number>} process exit code
 */
export async function runAppProxyStart(opts) {
  const log = opts.log ?? ((line) => console.error(line))
  const app = assertProxyAppName(opts.app)
  const runDir = opts.runDir?.trim() || QCTL_RUN_DIR_DEFAULT
  const sockPath = opts.sockPath?.trim() || appsSockPath(runDir)
  const request = opts.request ?? supervisorRequest
  const notify = opts.notify ?? sdNotify
  const exitProcess = opts.exitProcess !== false

  /** @param {number} code */
  const finish = (code) => {
    if (exitProcess) process.exit(code)
    return code
  }

  try {
    const ensured = await request(sockPath, { method: 'ensure', params: { app } })
    if (!ensured.ok) {
      log(`qctl-app proxy: ensure failed: ${ensured.error}`)
      return finish(1)
    }

    const ready = await waitAppReady(app, {
      runDir,
      timeoutMs: opts.readyTimeoutMs,
      signal: opts.signal,
    })
    if (ready === 'failed') {
      log(`qctl-app proxy: ${app} failed before ready`)
      return finish(1)
    }

    // Status RPC (stamp view) — keeps protocol exercised before notify.
    const st = await request(sockPath, { method: 'status', params: { app } })
    if (!st.ok) {
      log(`qctl-app proxy: status failed: ${st.error}`)
      return finish(1)
    }

    await notify('READY=1')

    const watch = await request(
      sockPath,
      { method: 'watch', params: { app } },
      { timeoutMs: 0, signal: opts.signal },
    )
    if (!watch.ok) {
      if (opts.signal?.aborted) return finish(0)
      log(`qctl-app proxy: watch failed: ${watch.error}`)
      return finish(1)
    }
    const reason = watch.result && 'reason' in watch.result ? watch.result.reason : 'cleared'
    log(`qctl-app proxy: ${app} watch ended (${reason})`)
    return finish(1)
  } catch (err) {
    if (opts.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return finish(0)
    }
    if (err instanceof SupervisorUnavailableError) {
      log(err.message)
      return finish(1)
    }
    log(`qctl-app proxy: ${err instanceof Error ? err.message : String(err)}`)
    return finish(1)
  }
}

/**
 * ExecStop path: release hold on the real app.
 * @param {{
 *   app: string,
 *   runDir?: string,
 *   sockPath?: string,
 *   request?: typeof supervisorRequest,
 *   exitProcess?: boolean,
 *   log?: (line: string) => void,
 * }} opts
 * @returns {Promise<number>}
 */
export async function runAppProxyRelease(opts) {
  const log = opts.log ?? ((line) => console.error(line))
  const app = assertProxyAppName(opts.app)
  const runDir = opts.runDir?.trim() || QCTL_RUN_DIR_DEFAULT
  const sockPath = opts.sockPath?.trim() || appsSockPath(runDir)
  const request = opts.request ?? supervisorRequest
  const exitProcess = opts.exitProcess !== false

  /** @param {number} code */
  const finish = (code) => {
    if (exitProcess) process.exit(code)
    return code
  }

  try {
    const res = await request(sockPath, { method: 'release', params: { app } })
    if (!res.ok) {
      log(`qctl-app proxy: release failed: ${res.error}`)
      return finish(1)
    }
    return finish(0)
  } catch (err) {
    if (err instanceof SupervisorUnavailableError) {
      log(err.message)
      return finish(1)
    }
    log(`qctl-app proxy: ${err instanceof Error ? err.message : String(err)}`)
    return finish(1)
  }
}
