/**
 * Entrypoint for `qctl _internal_supervisor` (long-running daemon).
 */
import { readOsConfig } from '../os-config.js'
import { QCTL_RUN_DIR_DEFAULT } from './paths.js'
import { startSupervisorServer } from './server.js'

/**
 * @param {{
 *   runDir?: string,
 *   osConfigPath?: string,
 *   log?: (line: string) => void,
 *   signal?: AbortSignal,
 *   exitProcess?: boolean,
 * }} [opts]
 * @returns {Promise<void>}
 */
export async function runSupervisorDaemon(opts = {}) {
  const log = opts.log ?? ((line) => console.error(line))
  const osConfig = readOsConfig(opts.osConfigPath)
  const runDir = opts.runDir?.trim() || QCTL_RUN_DIR_DEFAULT
  const exitProcess = opts.exitProcess !== false

  const server = await startSupervisorServer({
    osConfig,
    runDir,
    log,
    chownSockets: process.getuid?.() === 0,
  })

  await new Promise((/** @type {(v?: void) => void} */ resolve) => {
    let stopped = false
    /**
     * @param {string} sig
     */
    const shutdown = async (sig) => {
      if (stopped) return
      stopped = true
      log(`qctl-supervisor: ${sig}, shutting down`)
      await server.close()
      resolve()
      if (exitProcess) process.exit(0)
    }
    process.on('SIGTERM', () => void shutdown('SIGTERM'))
    process.on('SIGINT', () => void shutdown('SIGINT'))
    if (opts.signal) {
      if (opts.signal.aborted) void shutdown('abort')
      else opts.signal.addEventListener('abort', () => void shutdown('abort'), { once: true })
    }
  })
}
