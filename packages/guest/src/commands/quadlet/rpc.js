/**
 * Thin admin.sock client for `qctl quadlet …` — no library imports.
 */
import { readOsConfig } from '../../os-config.js'
import { SupervisorUnavailableError, supervisorQuadletRequest } from '../../supervisor/client.js'
import { adminSockPath } from '../../supervisor/paths.js'

/** @import { QuadletParams } from '../../supervisor/protocol.js' */

/**
 * @typedef {object} QuadletArgv
 * @property {string | string[]} [app]
 * @property {string | string[]} [apps]
 * @property {boolean} [dryRun]
 * @property {boolean} [install]
 */

/**
 * Normalize yargs `apps` / legacy `app` into a string list.
 * @param {QuadletArgv} argv
 * @returns {string[]}
 */
export function argvApps(argv) {
  const raw = argv.apps ?? argv.app
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string' && raw) return [raw]
  return []
}

/**
 * Call supervisor with a structured quadlet op (already parsed by yargs).
 * @param {QuadletParams} params
 * @param {{
 *   osConfigPath?: string,
 *   runDir?: string,
 * }} [opts]
 * @returns {Promise<void>}
 */
export async function callQuadlet(params, opts = {}) {
  try {
    const osConfig = readOsConfig(opts.osConfigPath)
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1
    if (uid !== 0 && uid !== osConfig.admin.uid) {
      console.error(
        `quadlet: ERROR: need admin (uid ${osConfig.admin.uid}) or root — qctl quadlet talks to qctl-supervisor (no sudo)`,
      )
      process.exitCode = 1
      return
    }

    const sockPath = adminSockPath(opts.runDir)
    const res = await supervisorQuadletRequest(
      sockPath,
      { method: 'quadlet', params },
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
      console.error(`quadlet: ERROR: ${res.error}`)
      process.exitCode = 1
      return
    }
    if (res.result?.method === 'quadlet') {
      process.exitCode = res.result.exitCode
    }
  } catch (e) {
    if (e instanceof SupervisorUnavailableError) {
      console.error(`quadlet: ERROR: ${e.message}`)
      process.exitCode = 1
      return
    }
    throw e
  }
}
