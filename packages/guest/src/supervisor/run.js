/**
 * Entrypoint for `qctl _internal_supervisor` (long-running daemon).
 */
import { asyncExitHook } from 'exit-hook'

import { readOsConfig } from '../os-config.js'
import { createAppHolds } from './ensure.js'
import { QCTL_RUN_DIR_DEFAULT } from './paths.js'
import { createContext, resolveInstanceRoot } from './quadlet/context.js'
import { createQuadletOps, invokeQuadletOp } from './quadlet/ops.js'
import { createSecretOps, invokeSecretOp } from './secret/ops.js'
import { startSupervisorServer } from './server.js'

/** @import { QuadletRequest, QuadletResult, SecretRequest, SecretResult } from './protocol.js' */
/** @import { QuadletContext } from './quadlet/context.js' */

/** Max time for socket close + monitor dispose on SIGTERM/SIGINT. */
const SHUTDOWN_WAIT_MS = 10_000

/**
 * @param {{
 *   runDir?: string,
 *   osConfigPath?: string,
 *   log?: (line: string) => void,
 *   signal?: AbortSignal,
 *   exitProcess?: boolean,
 *   holds?: ReturnType<typeof createAppHolds>,
 *   ctx?: QuadletContext,
 * }} [opts]
 * @returns {Promise<void>}
 */
export async function runSupervisorDaemon(opts = {}) {
  const log = opts.log ?? ((line) => console.error(line))
  const osConfig = readOsConfig(opts.osConfigPath)
  const runDir = opts.runDir?.trim() || QCTL_RUN_DIR_DEFAULT
  const exitProcess = opts.exitProcess !== false

  const ctx =
    opts.ctx
    ?? createContext({
      root: resolveInstanceRoot({ osConfig }),
      osConfig,
      log: (m) => log(`qctl-supervisor: ${m}`),
    })

  const lifetime = new AbortController()
  if (opts.signal) {
    if (opts.signal.aborted) lifetime.abort()
    else opts.signal.addEventListener('abort', () => lifetime.abort(), { once: true })
  }

  const holds =
    opts.holds
    ?? createAppHolds({
      runDir,
      ctx,
      log,
      signal: lifetime.signal,
    })

  /**
   * Admin RPC → quadlet libraries (streams via hctx writers).
   * @param {QuadletRequest} req
   * @param {{
   *   writeStdout?: (data: string) => void,
   *   writeStderr?: (data: string) => void,
   * }} hctx
   * @returns {Promise<QuadletResult>}
   */
  const quadletHandler = async (req, hctx) => {
    const writeStdout = hctx.writeStdout ?? (() => {})
    const writeStderr = hctx.writeStderr ?? (() => {})
    const qctx = createContext({
      root: ctx.root,
      osConfig,
      sys: ctx.sys,
      log: (m) => writeStdout(`quadlet: ${m}\n`),
      print: (m) => writeStdout(`${m}\n`),
    })

    const answer = await invokeQuadletOp(createQuadletOps(qctx), req.params)
    if (answer.error) writeStderr(`quadlet: ERROR: ${answer.error}\n`)
    return { method: 'quadlet', exitCode: answer.exitCode }
  }

  /**
   * Secret RPC → libraries (streams via hctx writers). Apps sock → rootlessOnly.
   * @param {SecretRequest} req
   * @param {{
   *   kind: 'apps' | 'admin',
   *   writeStdout?: (data: string) => void,
   *   writeStderr?: (data: string) => void,
   * }} hctx
   * @returns {Promise<SecretResult>}
   */
  const secretHandler = async (req, hctx) => {
    const writeStdout = hctx.writeStdout ?? (() => {})
    const writeStderr = hctx.writeStderr ?? (() => {})
    const answer = await invokeSecretOp(
      createSecretOps({
        root: ctx.root,
        osConfig,
        rootlessOnly: hctx.kind === 'apps',
        log: (m) => writeStdout(`${m}\n`),
      }),
      req.params,
    )
    if (answer.error) writeStderr(`secret: ERROR: ${answer.error}\n`)
    return { method: 'secret', exitCode: answer.exitCode }
  }

  const server = await startSupervisorServer({
    osConfig,
    runDir,
    log,
    handlers: { ...holds.handlers(), quadlet: quadletHandler, secret: secretHandler },
    chownSockets: process.getuid?.() === 0,
  })

  let stopped = false
  /**
   * @param {string} reason
   */
  const shutdown = async (reason) => {
    if (stopped) return
    stopped = true
    log(`qctl-supervisor: ${reason}, shutting down`)
    lifetime.abort()
    holds.dispose()
    await server.close()
  }

  if (exitProcess) {
    // exit-hook owns SIGINT/SIGTERM; after cleanup it process.exit's.
    asyncExitHook(
      async () => {
        await shutdown('exit-hook')
      },
      { wait: SHUTDOWN_WAIT_MS },
    )
    await new Promise(() => {})
    return
  }

  // Tests: AbortSignal only — do not register process-wide exit hooks.
  await new Promise((/** @type {(v?: void) => void} */ resolve) => {
    const onAbort = () => {
      void shutdown('abort').then(() => resolve())
    }
    if (!opts.signal) {
      resolve()
      return
    }
    if (opts.signal.aborted) onAbort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })
  })
}
