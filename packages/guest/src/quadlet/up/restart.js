/**
 * Daemon-reload, topo-sorted restarts, and filtered start-if-needed for `quadlet up`.
 */
import { appDir, appServiceNames, readEngine, topoSortApps } from '../apps/index.js'
import { die } from '../errors.js'
/** @import { UpSession } from './session.js' */

/**
 * @param {UpSession} s
 */
export function reloadDaemons(s) {
  const { ctx, needReload, restartApps, dirtyNetworks, reloadEngines } = s
  if (!(needReload || restartApps.length > 0 || dirtyNetworks.length > 0)) return
  for (const eng of reloadEngines) {
    if (eng === 'rootless') ctx.sys.ensureRootlessBus()
    ctx.log(`daemon-reload (${eng})`)
    ctx.sys.systemctl(eng, ['daemon-reload'])
  }
}

/**
 * Restart changed apps in unit-dep order (deps before dependents).
 * With Notify=healthy, each systemctl restart blocks until healthy.
 * @param {UpSession} s
 * @returns {string[]} restart order used (for done log)
 */
export function restartChangedApps(s) {
  const { ctx, restartApps } = s
  const restartList = topoSortApps(ctx, restartApps)
  for (const app of restartList) {
    const dir = appDir(ctx, app)
    if (!dir) continue
    const engine = readEngine(dir)
    if (engine === 'rootless') ctx.sys.ensureRootlessBus()
    for (const svc of appServiceNames(dir)) {
      ctx.log(`restart ${svc} (${engine})`)
      ctx.sys.systemctl(engine, ['reset-failed', svc], { ignoreStderr: true })
      const active =
        ctx.sys.systemctl(engine, ['is-active', '--quiet', svc], { capture: true }).status === 0
      const failed =
        !active
        && ctx.sys.systemctl(engine, ['is-failed', '--quiet', svc], { capture: true }).status === 0
      const r = ctx.sys.systemctl(engine, [active || failed ? 'restart' : 'start', svc])
      if (r.status !== 0)
        die(`systemctl ${active || failed ? 'restart' : 'start'} ${svc} failed (exit ${r.status})`)
    }
  }
  return restartList
}

/**
 * Filtered up with nothing dirty: still ensure targets are started.
 * @param {UpSession} s
 */
export function startFilteredIfNeeded(s) {
  const { ctx, filtered, filterList, restartApps } = s
  if (restartApps.length > 0 || !filtered) return
  for (const name of filterList) {
    const dir = appDir(ctx, name)
    if (!dir) continue
    const engine = readEngine(dir)
    if (engine === 'rootless') ctx.sys.ensureRootlessBus()
    for (const svc of appServiceNames(dir)) {
      if (ctx.sys.systemctl(engine, ['is-active', '--quiet', svc], { capture: true }).status === 0)
        continue
      ctx.log(`start ${svc} (${engine})`)
      const r = ctx.sys.systemctl(engine, ['start', svc])
      if (r.status !== 0) die(`systemctl start ${svc} failed (exit ${r.status})`)
    }
  }
}

/**
 * @param {UpSession} s
 * @param {string[]} restartList
 */
export function logUpDone(s, restartList) {
  const { ctx, filtered, filterList, restartApps } = s
  if (restartApps.length === 0) {
    if (filtered) ctx.log(`done (started ${filterList.join(' ')} if needed)`)
    else ctx.log('done (no restarts)')
  } else {
    ctx.log(`done (restarted: ${restartList.join(' ')})`)
  }
}
