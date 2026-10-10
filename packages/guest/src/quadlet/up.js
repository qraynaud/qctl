/**
 * `quadlet up`: reconcile installed Quadlets with the repo (compose-up-ish).
 * Down orphans, update changed apps, register new ones; `--dry-run` only plans.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  QUADLET_EXTS,
  SYSTEMD_EXTS,
  appDir,
  appHasUnits,
  appServiceNames,
  expandUnitDepApps,
  globExts,
  listRepoApps,
  listUnitDirs,
  markEnabled,
  markerDir,
  markerEngine,
  packageUnitFiles,
  readEngine,
  resolveAppName,
  stopAndRemoveApp,
  topoSortApps,
} from './apps.js'
import { loadNetworkRenderEnv, loadRenderEnv, runtimeUnitDirs } from './env.js'
import { die } from './errors.js'
import {
  autostartDiffers,
  installIfChanged,
  installUnitEnvIfChanged,
  linkTopLevelNetworks,
  syncAutostart,
  templateDiffers,
  unitEnvDiffers,
  unitInstallDir,
  wantsAutostart,
} from './install.js'
import {
  appNetworkRefs,
  appUsesNetworks,
  installNetworkHostMacvlan,
  listSharedNetworkFiles,
  networkLiveStale,
  networkRefsFromFile,
  networkSharedEngine,
  networksSrc,
  recreatePodmanNetwork,
  removeNetworkUnit,
  sharedNetworkFile,
} from './networks.js'
/** @import { QuadletContext } from './context.js' */
/** @import { RenderEnv } from './env.js' */
/** @import { Engine, EnginePaths } from './system.js' */

/**
 * @typedef {object} Entry
 * @property {string} marker  marker file path ("" = new app, not yet registered)
 * @property {string} app
 * @property {Engine} engine
 */

/**
 * @param {QuadletContext} ctx
 * @param {{ dryRun?: boolean, app?: string }} [opts]
 * @returns {Promise<void>}
 */
export async function runUp(ctx, opts = {}) {
  const dry = Boolean(opts.dryRun)
  const appFilter = opts.app ? resolveAppName(opts.app) : ''

  /** @type {Entry[]} */
  const markers = []
  /** @type {string[]} */
  const restartApps = []
  /** @type {Engine[]} */
  const reloadEngines = []
  /** @type {string[]} */
  const dirtyNetworks = []
  let needReload = false
  let dryActions = 0
  /** @type {Set<string>} */
  const planned = new Set()

  /** @param {string} action @param {string} name */
  const will = (action, name) => {
    ctx.print(`will ${action} ${name}`)
    dryActions++
  }
  /** @param {string} action @param {string} name */
  const plan = (action, name) => {
    const key = `${action}:${name}`
    if (planned.has(key)) return
    planned.add(key)
    will(action, name)
  }
  /** @param {string} app */
  const markRestart = (app) => {
    if (!restartApps.includes(app)) restartApps.push(app)
  }
  /** @param {Engine} e */
  const noteEngine = (e) => {
    if (!reloadEngines.includes(e)) reloadEngines.push(e)
  }
  /** @param {string} base */
  const noteDirtyNetwork = (base) => {
    if (!dirtyNetworks.includes(base)) dirtyNetworks.push(base)
  }
  /** @param {string} app */
  const markerAlready = (app) => markers.some((m) => m.app === app)

  /**
   * @param {EnginePaths} paths
   * @param {Engine} defaultEngine
   */
  function collectMarkersFrom(paths, defaultEngine) {
    const d = markerDir(paths.dest)
    /** @returns {string[]} */
    const listMarkers = () => {
      try {
        return readdirSync(d)
          .filter((n) => !n.startsWith('.') && statSync(join(d, n)).isFile())
          .sort()
      } catch {
        return []
      }
    }
    if (!dry) {
      mkdirSync(d, { recursive: true })
      ctx.sys.chown(paths.engine, d)
    }
    if (!dry && !appFilter && listMarkers().length === 0) {
      /** @type {string[]} */
      const containers = [...globExts(paths.dest, ['container'])]
      try {
        for (const n of readdirSync(paths.dest)) {
          const sub = join(paths.dest, n)
          try {
            if (statSync(sub).isDirectory() && !n.startsWith('.')) {
              containers.push(...globExts(sub, ['container']))
            }
          } catch {
            // dangling
          }
        }
      } catch {
        // dest missing
      }
      for (const c of containers) {
        const app = basename(c, '.container')
        const dir = appDir(ctx, app)
        if (!dir) continue
        const eng = readEngine(dir)
        if (eng !== defaultEngine) continue
        markEnabled(ctx, app, ctx.sys.paths(eng))
        ctx.log(`seeded enabled marker for ${app} (${eng})`)
      }
    }
    for (const app of listMarkers()) {
      if (appFilter && app !== appFilter) continue
      const marker = join(d, app)
      const e = markerEngine(marker)
      markers.push({
        marker,
        app,
        engine: e === 'rootless' || e === 'rootful' ? e : defaultEngine,
      })
    }
  }

  function registerRepoApps() {
    if (appFilter) {
      const dir = appDir(ctx, appFilter)
      if (!dir) {
        if (markerAlready(appFilter)) return
        die(`unknown app '${appFilter}' (no applications/${appFilter}/app.yaml)`)
      }
      // Companions from unit After=/Wants=/… first, then the target app.
      for (const name of expandUnitDepApps(ctx, appFilter)) {
        if (markerAlready(name)) continue
        const ddir = appDir(ctx, name)
        if (!ddir) die(`unit dep: unknown app '${name}' (from ${appFilter})`)
        if (!appHasUnits(ddir)) {
          if (!dry) ctx.log(`skip ${name} (no units)`)
          continue
        }
        markers.push({ marker: '', app: name, engine: readEngine(ddir) })
      }
      if (markerAlready(appFilter)) return
      if (!appHasUnits(dir)) {
        if (!dry) ctx.log(`skip ${appFilter} (no units)`)
        return
      }
      markers.push({ marker: '', app: appFilter, engine: readEngine(dir) })
      return
    }
    for (const name of listRepoApps(ctx)) {
      if (markerAlready(name)) continue
      const dir = appDir(ctx, name)
      if (!dir || !appHasUnits(dir)) continue
      markers.push({ marker: '', app: name, engine: readEngine(dir) })
    }
  }

  /**
   * Wanted .network basenames for `engine` given markers (repo truth).
   * @param {Engine} engine
   * @returns {Set<string>}
   */
  function wantedNetworkBasenames(engine) {
    /** @type {Set<string>} */
    const want = new Set()
    for (const f of listSharedNetworkFiles(ctx)) {
      if (networkSharedEngine(f) === engine) want.add(basename(f))
    }
    for (const m of markers) {
      const dir = appDir(ctx, m.app)
      if (!dir) continue
      if (readEngine(dir) !== engine) continue
      for (const f of globExts(dir, ['network'])) want.add(basename(f))
      // Unit-private networks stay under dest/<unit>/; only package-root nets are top-level.
    }
    return want
  }

  /** Remove installed .network units no longer shipped. @param {Engine} engine */
  function pruneOrphanNetworks(engine) {
    const paths = ctx.sys.paths(engine)
    if (!existsSync(paths.dest)) return
    const want = wantedNetworkBasenames(engine)
    for (const base of readdirSync(paths.dest)
      .filter((n) => n.endsWith('.network'))
      .sort()) {
      if (want.has(base)) continue
      if (dry) {
        will('remove', base)
        continue
      }
      ctx.log(`remove orphan network ${base} (${engine})`)
      removeNetworkUnit(ctx, paths, base)
      needReload = true
      noteEngine(engine)
    }
  }

  function pruneOrphansForFilter() {
    if (!appFilter) {
      pruneOrphanNetworks('rootless')
      pruneOrphanNetworks('rootful')
      return
    }
    const dir = appDir(ctx, appFilter)
    if (dir) {
      pruneOrphanNetworks(readEngine(dir))
    } else {
      pruneOrphanNetworks('rootless')
      pruneOrphanNetworks('rootful')
    }
  }

  // --- shared networks/<name>/ (rootless bridges + rootful macvlan/ipvlan) ---
  async function installSharedNetworks() {
    if (!networksSrc(ctx)) return
    /** @type {Set<string>} */
    const wantRootless = new Set()
    /** @type {Set<string>} */
    const wantRootful = new Set()

    if (!appFilter) {
      for (const f of listSharedNetworkFiles(ctx)) {
        ;(networkSharedEngine(f) === 'rootful' ? wantRootful : wantRootless).add(basename(f))
      }
    } else {
      for (const m of markers) {
        const dir = appDir(ctx, m.app)
        if (!dir) continue
        const eng = readEngine(dir)
        for (let ref of appNetworkRefs(dir)) {
          if (!ref.endsWith('.network')) ref = `${ref}.network`
          if (!sharedNetworkFile(ctx, ref)) continue
          ;(eng === 'rootful' ? wantRootful : wantRootless).add(ref)
        }
      }
    }

    /**
     * @param {Engine} engine
     * @param {Set<string>} want
     */
    const installFor = async (engine, want) => {
      if (want.size === 0) return
      const paths = ctx.sys.paths(engine)
      if (!dry) {
        mkdirSync(paths.dest, { recursive: true })
        ctx.sys.chown(engine, paths.dest)
      }
      for (const base of [...want].sort()) {
        const f = sharedNetworkFile(ctx, base)
        if (!f) continue
        const dest = join(paths.dest, base)
        const renv = await loadNetworkRenderEnv(ctx, f)
        if (dry) {
          if (templateDiffers(f, dest, renv)) noteDirtyNetwork(base)
          else if (existsSync(dest) && networkLiveStale(ctx, paths, dest)) noteDirtyNetwork(base)
          continue
        }
        if (installIfChanged(ctx, paths, f, dest, renv)) {
          ctx.log(`updated ${dest} (${engine} shared)`)
          noteDirtyNetwork(base)
          needReload = true
          noteEngine(engine)
        } else if (existsSync(dest) && networkLiveStale(ctx, paths, dest)) {
          ctx.log(`stale podman network vs ${dest} (${engine}) — will recreate`)
          noteDirtyNetwork(base)
          noteEngine(engine)
        }
        // Host macvlan shim — reconcile when the package ships it.
        try {
          installNetworkHostMacvlan(ctx, paths, f, renv)
        } catch (e) {
          ctx.log(
            `warning: host macvlan for ${base}: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
    }
    await installFor('rootless', wantRootless)
    await installFor('rootful', wantRootful)
  }

  /**
   * @param {string} dir
   * @param {EnginePaths} paths
   * @param {RenderEnv} renv
   * @returns {Promise<boolean>}
   */
  async function appUnitsDiffer(dir, paths, renv) {
    for (const f of globExts(dir, QUADLET_EXTS)) {
      const dest = join(paths.dest, basename(f))
      if (templateDiffers(f, dest, renv)) return true
      if (wantsAutostart(basename(f)) && autostartDiffers(dest, paths.engine)) return true
    }
    for (const udir of listUnitDirs(dir)) {
      const unitDest = unitInstallDir(paths, udir)
      for (const f of globExts(udir, QUADLET_EXTS)) {
        const dest = join(unitDest, basename(f))
        if (templateDiffers(f, dest, renv)) return true
        if (wantsAutostart(basename(f)) && autostartDiffers(dest, paths.engine)) return true
      }
    }
    for (const f of packageUnitFiles(dir, SYSTEMD_EXTS)) {
      if (templateDiffers(f, join(paths.sysDest, basename(f)), renv)) return true
    }
    for (const udir of runtimeUnitDirs(dir)) {
      if (await unitEnvDiffers(udir, join(unitInstallDir(paths, udir), '.env'), renv, ctx))
        return true
    }
    return false
  }

  function restartAppsUsingDirtyNetworks() {
    if (dirtyNetworks.length === 0) return
    for (const m of markers) {
      const dir = appDir(ctx, m.app)
      if (!dir) continue
      if (!appUsesNetworks(dir, dirtyNetworks)) continue
      if (dry) plan('restart', m.app)
      else markRestart(m.app)
    }
  }

  // --- collect + register ---------------------------------------------------
  collectMarkersFrom(ctx.sys.paths('rootless'), 'rootless')
  collectMarkersFrom(ctx.sys.paths('rootful'), 'rootful')
  registerRepoApps()

  // --- dry-run: plan only ---------------------------------------------------
  if (dry) {
    await installSharedNetworks()
    for (const base of dirtyNetworks) plan('update', base)

    for (const m of markers) {
      const dir = appDir(ctx, m.app)
      if (!dir) {
        plan('remove', m.app)
        continue
      }
      const repoEngine = readEngine(dir)
      const paths = ctx.sys.paths(repoEngine)
      if (!m.marker) {
        plan('add', m.app)
        continue
      }
      const renv = await loadRenderEnv(ctx, dir)
      if (await appUnitsDiffer(dir, paths, renv)) plan('update', m.app)
    }

    restartAppsUsingDirtyNetworks()
    pruneOrphansForFilter()
    if (dryActions === 0) ctx.print('nothing to do')
    return
  }

  // --- real run -------------------------------------------------------------
  /**
   * @param {string} app
   * @param {Engine} engineIn
   * @param {boolean} isNew
   */
  async function reconcileApp(app, engineIn, isNew) {
    let engine = engineIn
    let paths = ctx.sys.paths(engine)
    noteEngine(engine)
    mkdirSync(paths.dest, { recursive: true })
    mkdirSync(paths.sysDest, { recursive: true })
    ctx.sys.chown(engine, paths.dest)
    ctx.sys.chown(engine, paths.sysDest)

    const dir = appDir(ctx, app)
    if (!dir) {
      ctx.log(`remove orphan ${app} (${engine})`)
      stopAndRemoveApp(ctx, app, paths)
      needReload = true
      return
    }

    const repoEngine = readEngine(dir)
    if (repoEngine !== engine) {
      ctx.log(`engine change ${app}: ${engine} → ${repoEngine}`)
      engine = repoEngine
      paths = ctx.sys.paths(engine)
      noteEngine(engine)
    }

    const renv = await loadRenderEnv(ctx, dir)
    let changed = false

    // Package-root shared Quadlets → dest top-level.
    for (const f of globExts(dir, QUADLET_EXTS)) {
      const dest = join(paths.dest, basename(f))
      if (installIfChanged(ctx, paths, f, dest, renv)) {
        ctx.log(`updated ${dest}`)
        changed = true
      }
      // Networks have no [Install]; wantsAutostart skips them.
      if (wantsAutostart(basename(f)) && syncAutostart(ctx, paths, dest, true)) {
        ctx.log(`updated ${dest}.d/autostart.conf`)
        changed = true
      }
    }
    // Unit subdirs → dest/<unit>/ + .env; symlink top-level Network= refs.
    for (const udir of listUnitDirs(dir)) {
      const unitDest = unitInstallDir(paths, udir)
      mkdirSync(unitDest, { recursive: true })
      ctx.sys.chown(engine, unitDest)
      /** @type {string[]} */
      const netRefs = []
      for (const f of globExts(udir, QUADLET_EXTS)) {
        const dest = join(unitDest, basename(f))
        if (installIfChanged(ctx, paths, f, dest, renv)) {
          ctx.log(`updated ${dest}`)
          changed = true
        }
        if (wantsAutostart(basename(f)) && syncAutostart(ctx, paths, dest, true)) {
          ctx.log(`updated ${dest}.d/autostart.conf`)
          changed = true
        }
        netRefs.push(...networkRefsFromFile(f))
      }
      linkTopLevelNetworks(ctx, paths, unitDest, [...new Set(netRefs)])
    }
    for (const f of packageUnitFiles(dir, SYSTEMD_EXTS)) {
      const dest = join(paths.sysDest, basename(f))
      if (installIfChanged(ctx, paths, f, dest, renv)) {
        ctx.log(`updated ${dest}`)
        changed = true
      }
    }
    for (const udir of runtimeUnitDirs(dir)) {
      const dest = join(unitInstallDir(paths, udir), '.env')
      if (await installUnitEnvIfChanged(ctx, paths, udir, dest, renv)) {
        ctx.log(`updated ${dest}`)
        changed = true
      }
    }

    if (changed || isNew) {
      if (isNew) ctx.log(`add ${app} (${engine})`)
      markRestart(app)
      needReload = true
    } else {
      ctx.log(`unchanged ${app} (${engine})`)
    }
    markEnabled(ctx, app, paths)
  }

  // Shared networks before apps.
  await installSharedNetworks()

  if (markers.length === 0) {
    ctx.log('no apps to reconcile')
  } else {
    for (const m of markers) await reconcileApp(m.app, m.engine, m.marker === '')
    restartAppsUsingDirtyNetworks()
  }

  pruneOrphansForFilter()

  if (needReload || restartApps.length > 0 || dirtyNetworks.length > 0) {
    for (const eng of reloadEngines) {
      if (eng === 'rootless') ctx.sys.ensureRootlessBus()
      ctx.log(`daemon-reload (${eng})`)
      ctx.sys.systemctl(eng, ['daemon-reload'])
    }
  }

  // Podman does not mutate an existing network when the Quadlet .network file
  // changes. Stop consumers, rm, start unit.
  if (dirtyNetworks.length > 0) {
    for (const m of markers) {
      const dir = appDir(ctx, m.app)
      if (!dir) continue
      if (!appUsesNetworks(dir, dirtyNetworks)) continue
      markRestart(m.app)
      const engine = readEngine(dir)
      if (engine === 'rootless') ctx.sys.ensureRootlessBus()
      for (const svc of appServiceNames(dir)) {
        ctx.log(`stop ${svc} (${engine}; network recreate)`)
        ctx.sys.systemctl(engine, ['stop', svc], { ignoreStderr: true })
      }
    }
    for (const base of dirtyNetworks) {
      const f = sharedNetworkFile(ctx, base)
      if (!f) continue
      const eng = networkSharedEngine(f)
      const paths = ctx.sys.paths(eng)
      if (eng === 'rootless') ctx.sys.ensureRootlessBus()
      if (!recreatePodmanNetwork(ctx, paths, base)) {
        ctx.log(`warning: could not recreate ${base} (${eng})`)
      }
    }
  }

  // Restart changed apps in unit-dep order (deps before dependents).
  // With Notify=healthy, each systemctl restart blocks until healthy.
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

  if (restartApps.length === 0) {
    const dir = appFilter ? appDir(ctx, appFilter) : null
    if (appFilter && dir) {
      // Filtered up with nothing dirty: still ensure target is started.
      const engine = readEngine(dir)
      if (engine === 'rootless') ctx.sys.ensureRootlessBus()
      for (const svc of appServiceNames(dir)) {
        if (
          ctx.sys.systemctl(engine, ['is-active', '--quiet', svc], { capture: true }).status === 0
        )
          continue
        ctx.log(`start ${svc} (${engine})`)
        const r = ctx.sys.systemctl(engine, ['start', svc])
        if (r.status !== 0) die(`systemctl start ${svc} failed (exit ${r.status})`)
      }
      ctx.log(`done (started ${appFilter} if needed)`)
    } else {
      ctx.log('done (no restarts)')
    }
  } else {
    ctx.log(`done (restarted: ${restartList.join(' ')})`)
  }
}
