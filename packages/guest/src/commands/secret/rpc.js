/**
 * Thin supervisor client for `qctl secret …` — no library imports.
 * Admin/root → admin.sock; apps → apps.sock (requires `--app`).
 */
import { readOsConfig } from '../../os-config.js'
import { SupervisorUnavailableError, supervisorSecretRequest } from '../../supervisor/client.js'
import { adminSockPath, appsSockPath } from '../../supervisor/paths.js'

/** @import { SecretParams } from '../../supervisor/protocol.js' */

/**
 * @typedef {object} SecretArgv
 * @property {string} [app]
 * @property {string} [env]
 * @property {boolean} [dryRun]
 * @property {boolean} [restart]
 */

/**
 * Call supervisor with a structured secret op (already parsed by yargs).
 * @param {SecretParams} params
 * @param {{
 *   osConfigPath?: string,
 *   runDir?: string,
 * }} [opts]
 * @returns {Promise<void>}
 */
export async function callSecret(params, opts = {}) {
  try {
    const osConfig = readOsConfig(opts.osConfigPath)
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1
    const appsUid = osConfig.apps.uid
    const adminUid = osConfig.admin.uid
    const isRoot = uid === 0
    const isAdmin = uid === adminUid
    const isApps = uid === appsUid

    if (!isRoot && !isAdmin && !isApps) {
      console.error(
        `secret: ERROR: need admin (uid ${adminUid}), apps (uid ${appsUid}), or root — qctl secret talks to qctl-supervisor (no sudo)`,
      )
      process.exitCode = 1
      return
    }

    if (isApps) {
      if (!params.app) {
        console.error('secret: ERROR: --app <name> is required when run as apps (ExecStartPre)')
        process.exitCode = 1
        return
      }
      if (params.op === 'sync' && params.restart) {
        console.error('secret: ERROR: --restart is not allowed when run as apps')
        process.exitCode = 1
        return
      }
    }

    const sockPath = isApps ? appsSockPath(opts.runDir) : adminSockPath(opts.runDir)
    const res = await supervisorSecretRequest(
      sockPath,
      { method: 'secret', params },
      {
        onStdout: (data) => {
          process.stdout.write(data)
        },
        onStderr: (data) => {
          process.stderr.write(data)
        },
        timeoutMs: 0,
      },
    )

    if (!res.ok) {
      console.error(`secret: ERROR: ${res.error}`)
      process.exitCode = 1
      return
    }
    if (res.result?.method === 'secret') {
      process.exitCode = res.result.exitCode
    }
  } catch (e) {
    if (e instanceof SupervisorUnavailableError) {
      console.error(`secret: ERROR: ${e.message}`)
      process.exitCode = 1
      return
    }
    throw e
  }
}
