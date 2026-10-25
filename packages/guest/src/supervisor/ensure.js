/**
 * Refcounted ensure/release for cross-engine app holds (qctl-app@ proxies).
 */
import { appDir, appServiceNames, resolveAppEngine } from '../quadlet/apps/index.js'
import { QuadletError } from '../quadlet/errors.js'
import {
  clearAppReady,
  isAppFailed,
  isAppReady,
  setAppFailed,
  setAppReady,
  watchAppUntilNotReady,
} from './stamps.js'

/** @import { QuadletContext } from '../quadlet/context.js' */
/** @import { Engine } from '../quadlet/system.js' */
/** @import { EnsureResult, ReleaseResult, StatusResult, WatchResult } from './protocol.js' */

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
 * Serialize ensure/release per app (refcount + stamp races).
 * @template T
 * @param {Map<string, Promise<void>>} chains
 * @param {string} app
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withAppLock(chains, app, fn) {
  const prev = chains.get(app) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  chains.set(
    app,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

/**
 * @param {QuadletContext} ctx
 * @param {Engine} engine
 * @param {string[]} svcs
 * @param {{ timeoutMs: number, pollMs: number }} opts
 * @returns {Promise<'active' | 'failed' | 'timeout'>}
 */
async function waitUnitsActive(ctx, engine, svcs, opts) {
  const deadline = Date.now() + opts.timeoutMs
  while (true) {
    let allActive = true
    for (const svc of svcs) {
      const failed =
        ctx.sys.systemctl(engine, ['is-failed', '--quiet', svc], { capture: true }).status === 0
      if (failed) return 'failed'
      const active =
        ctx.sys.systemctl(engine, ['is-active', '--quiet', svc], { capture: true }).status === 0
      if (!active) allActive = false
    }
    if (allActive) return 'active'
    if (Date.now() >= deadline) return 'timeout'
    await sleep(opts.pollMs)
  }
}

/**
 * Poll until aborted, refs drop, or a unit fails/goes inactive (then set failed stamp).
 * @param {{
 *   app: string,
 *   engine: Engine,
 *   svcs: string[],
 *   ctx: QuadletContext,
 *   runDir: string,
 *   refs: Map<string, number>,
 *   signal: AbortSignal,
 *   pollMs: number,
 *   log: (line: string) => void,
 * }} opts
 */
async function pollUnitHealth(opts) {
  const { app, engine, svcs, ctx, runDir, refs, signal, pollMs, log } = opts
  while (!signal.aborted) {
    try {
      await sleep(pollMs, signal)
    } catch {
      return
    }
    if ((refs.get(app) ?? 0) <= 0) return
    for (const svc of svcs) {
      const failed =
        ctx.sys.systemctl(engine, ['is-failed', '--quiet', svc], { capture: true }).status === 0
      const active =
        ctx.sys.systemctl(engine, ['is-active', '--quiet', svc], { capture: true }).status === 0
      if (failed || !active) {
        log(`qctl-supervisor: ${app}: unit ${svc} ${failed ? 'failed' : 'inactive'}`)
        setAppFailed(app, runDir)
        return
      }
    }
  }
}

/**
 * First holder: start units, wait active, set ready stamp.
 * @param {{
 *   app: string,
 *   engine: Engine,
 *   svcs: string[],
 *   ctx: QuadletContext,
 *   runDir: string,
 *   readyTimeoutMs: number,
 *   pollMs: number,
 *   log: (line: string) => void,
 * }} opts
 */
async function startAppUnits(opts) {
  const { app, engine, svcs, ctx, runDir, readyTimeoutMs, pollMs, log } = opts
  if (engine === 'rootless') ctx.sys.ensureRootlessBus()
  for (const svc of svcs) {
    log(`qctl-supervisor: ensure start ${svc} (${engine})`)
    ctx.sys.systemctl(engine, ['reset-failed', svc], { ignoreStderr: true })
    const r = ctx.sys.systemctl(engine, ['start', svc])
    if (r.status !== 0) {
      setAppFailed(app, runDir)
      throw new QuadletError(`systemctl start ${svc} failed (exit ${r.status})`)
    }
  }
  const wait = await waitUnitsActive(ctx, engine, svcs, {
    timeoutMs: readyTimeoutMs,
    pollMs,
  })
  if (wait !== 'active') {
    setAppFailed(app, runDir)
    for (const svc of svcs) {
      ctx.sys.systemctl(engine, ['stop', svc], { ignoreStderr: true })
    }
    throw new QuadletError(
      wait === 'failed'
        ? `app '${app}' unit failed while starting`
        : `app '${app}' not active within ${readyTimeoutMs}ms`,
    )
  }
  setAppReady(app, runDir)
}

/**
 * Bump refcount; start units on 0→1, or wait for ready on concurrent holds.
 * @param {{
 *   app: string,
 *   ctx: QuadletContext,
 *   runDir: string,
 *   refs: Map<string, number>,
 *   readyTimeoutMs: number,
 *   pollMs: number,
 *   log: (line: string) => void,
 *   resolveSvcs: (app: string) => { paths: { engine: Engine }, svcs: string[] },
 *   startMonitor: (app: string, engine: Engine, svcs: string[]) => void,
 * }} opts
 * @returns {Promise<EnsureResult>}
 */
async function acquireHold(opts) {
  const { app, ctx, runDir, refs, readyTimeoutMs, pollMs, log, resolveSvcs, startMonitor } = opts
  const { paths, svcs } = resolveSvcs(app)
  const engine = paths.engine
  const prev = refs.get(app) ?? 0
  const next = prev + 1
  refs.set(app, next)

  /** @param {Error} err */
  const rollback = (err) => {
    refs.set(app, prev)
    throw err
  }

  let started = false
  try {
    if (prev === 0) {
      await startAppUnits({ app, engine, svcs, ctx, runDir, readyTimeoutMs, pollMs, log })
      started = true
      startMonitor(app, engine, svcs)
    } else if (isAppFailed(app, runDir)) {
      throw new QuadletError(`app '${app}' is in failed state`)
    } else if (!isAppReady(app, runDir)) {
      const wait = await waitUnitsActive(ctx, engine, svcs, {
        timeoutMs: readyTimeoutMs,
        pollMs,
      })
      if (wait !== 'active') {
        setAppFailed(app, runDir)
        throw new QuadletError(`app '${app}' not ready for additional hold`)
      }
      setAppReady(app, runDir)
    }
  } catch (err) {
    rollback(err instanceof Error ? err : new Error(String(err)))
  }

  return { method: 'ensure', app, refs: next, engine, started }
}

/**
 * Drop one hold; stop units when refs hit 0.
 * @param {{
 *   app: string,
 *   ctx: QuadletContext,
 *   runDir: string,
 *   refs: Map<string, number>,
 *   log: (line: string) => void,
 *   resolveSvcs: (app: string) => { paths: { engine: Engine }, svcs: string[] },
 *   stopMonitor: (app: string) => void,
 * }} opts
 * @returns {Promise<ReleaseResult>}
 */
async function dropHold(opts) {
  const { app, ctx, runDir, refs, log, resolveSvcs, stopMonitor } = opts
  const prev = refs.get(app) ?? 0
  if (prev <= 0) {
    return { method: 'release', app, refs: 0, stopped: false }
  }

  const { paths, svcs } = resolveSvcs(app)
  const engine = paths.engine
  const next = prev - 1
  refs.set(app, next)

  let stopped = false
  if (next === 0) {
    stopMonitor(app)
    if (engine === 'rootless') ctx.sys.ensureRootlessBus()
    for (const svc of svcs) {
      log(`qctl-supervisor: release stop ${svc} (${engine})`)
      ctx.sys.systemctl(engine, ['stop', svc], { ignoreStderr: true })
    }
    clearAppReady(app, runDir)
    stopped = true
    refs.delete(app)
  }

  return { method: 'release', app, refs: next, stopped }
}

/**
 * @typedef {object} AppHoldHandlers
 * @property {(req: { params: { app: string } }) => Promise<EnsureResult>} ensure
 * @property {(req: { params: { app: string } }) => Promise<ReleaseResult>} release
 * @property {(req: { params: { app: string } }) => StatusResult} status
 * @property {(req: { params: { app: string } }) => Promise<WatchResult>} watch
 */

/**
 * @param {{
 *   runDir: string,
 *   ctx: QuadletContext,
 *   log?: (line: string) => void,
 *   readyTimeoutMs?: number,
 *   pollMs?: number,
 *   monitorPollMs?: number,
 *   signal?: AbortSignal,
 * }} opts
 */
export function createAppHolds(opts) {
  const runDir = opts.runDir
  const ctx = opts.ctx
  const log = opts.log ?? (() => {})
  const readyTimeoutMs = opts.readyTimeoutMs ?? 60_000
  const pollMs = opts.pollMs ?? 200
  const monitorPollMs = opts.monitorPollMs ?? 1_000
  const lifetime = opts.signal

  /** @type {Map<string, number>} */
  const refs = new Map()
  /** @type {Map<string, Promise<void>>} */
  const chains = new Map()
  /** @type {Map<string, AbortController>} */
  const monitors = new Map()

  /**
   * @param {string} app
   */
  function stopMonitor(app) {
    const ac = monitors.get(app)
    if (!ac) return
    ac.abort()
    monitors.delete(app)
  }

  /** Abort all unit-failure pollers (daemon shutdown). Does not release holds. */
  function dispose() {
    for (const app of [...monitors.keys()]) stopMonitor(app)
  }

  if (lifetime) {
    if (lifetime.aborted) dispose()
    else lifetime.addEventListener('abort', () => dispose(), { once: true })
  }

  /**
   * While refs > 0, mark failed if any unit drops.
   * Tied to per-app + daemon lifetime signals so shutdown does not need a kill.
   * @param {string} app
   * @param {Engine} engine
   * @param {string[]} svcs
   */
  function startMonitor(app, engine, svcs) {
    if (lifetime?.aborted) return
    stopMonitor(app)
    const ac = new AbortController()
    monitors.set(app, ac)
    const onLifetimeEnd = () => ac.abort()
    lifetime?.addEventListener('abort', onLifetimeEnd, { once: true })
    void pollUnitHealth({
      app,
      engine,
      svcs,
      ctx,
      runDir,
      refs,
      signal: ac.signal,
      pollMs: monitorPollMs,
      log,
    })
      .catch(() => {})
      .finally(() => {
        lifetime?.removeEventListener('abort', onLifetimeEnd)
        if (monitors.get(app) === ac) monitors.delete(app)
      })
  }

  /**
   * @param {string} app
   */
  function resolveSvcs(app) {
    const dir = appDir(ctx, app)
    if (!dir) throw new QuadletError(`unknown app '${app}' (no applications/${app}/app.yaml)`)
    const paths = resolveAppEngine(ctx, app)
    const svcs = appServiceNames(dir)
    if (svcs.length === 0) throw new QuadletError(`app '${app}' has no startable units`)
    return { paths, svcs }
  }

  /**
   * @param {string} app
   * @returns {Promise<EnsureResult>}
   */
  async function ensure(app) {
    return withAppLock(chains, app, () =>
      acquireHold({
        app,
        ctx,
        runDir,
        refs,
        readyTimeoutMs,
        pollMs,
        log,
        resolveSvcs,
        startMonitor,
      }),
    )
  }

  /**
   * @param {string} app
   * @returns {Promise<ReleaseResult>}
   */
  async function release(app) {
    return withAppLock(chains, app, () =>
      dropHold({
        app,
        ctx,
        runDir,
        refs,
        log,
        resolveSvcs,
        stopMonitor,
      }),
    )
  }

  /** @returns {AppHoldHandlers} */
  function handlers() {
    return {
      ensure: (req) => ensure(req.params.app),
      release: (req) => release(req.params.app),
      status: (req) => ({
        method: 'status',
        app: req.params.app,
        ready: isAppReady(req.params.app, runDir),
        failed: isAppFailed(req.params.app, runDir),
      }),
      watch: async (req) => {
        const reason = await watchAppUntilNotReady(req.params.app, { runDir })
        return { method: 'watch', app: req.params.app, reason }
      },
    }
  }

  return {
    ensure,
    release,
    handlers,
    dispose,
    /** @returns {Map<string, number>} */
    snapshotRefs: () => new Map(refs),
  }
}
