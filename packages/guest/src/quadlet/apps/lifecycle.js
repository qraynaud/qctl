import { existsSync, readdirSync, rmSync, rmdirSync } from 'node:fs'
import { basename, join } from 'node:path'

import { die } from '../errors.js'
import { appDir, appServiceNames, listUnitDirs, unitInstallName } from './discovery.js'
import { unmarkEnabled } from './markers.js'
/** @import { QuadletContext } from '../context.js' */
/** @import { EnginePaths } from '../system.js' */

/**
 * systemctl <action> for every service unit of an app.
 * @param {QuadletContext} ctx
 * @param {'start' | 'stop' | 'restart'} action
 * @param {string} app
 * @param {EnginePaths} paths
 */
export function appSystemctl(ctx, action, app, paths) {
  const d = appDir(ctx, app)
  if (!d) die(`unknown app '${app}' (no applications/${app}/app.yaml)`)
  if (paths.engine === 'rootless') ctx.sys.ensureRootlessBus()
  const svcs = appServiceNames(d)
  if (svcs.length === 0) die(`app '${app}' has no startable units`)
  for (const svc of svcs) {
    ctx.log(`${action} ${svc} (${paths.engine})`)
    const r = ctx.sys.systemctl(paths.engine, [action, svc])
    if (r.status !== 0) die(`systemctl ${action} ${svc} failed (exit ${r.status})`)
  }
}

/**
 * Stop app units, remove installed Quadlet/systemd files + marker; data stays.
 * @param {QuadletContext} ctx
 * @param {string} app
 * @param {EnginePaths} paths
 */
export function stopAndRemoveApp(ctx, app, paths) {
  if (paths.engine === 'rootless') ctx.sys.ensureRootlessBus()
  const quiet = { ignoreStderr: true }

  /** @param {string} svc */
  const stopDisable = (svc) => {
    ctx.log(`stop ${svc} (${paths.engine})`)
    ctx.sys.systemctl(paths.engine, ['stop', svc], quiet)
    ctx.sys.systemctl(paths.engine, ['disable', svc], quiet)
  }

  const d = appDir(ctx, app)
  if (d) {
    for (const svc of appServiceNames(d)) stopDisable(svc)
  } else {
    for (const ext of ['container', 'pod', 'kube']) {
      if (existsSync(join(paths.dest, `${app}.${ext}`))) stopDisable(`${app}.service`)
    }
    for (const ext of ['timer', 'service']) {
      const f = join(paths.sysDest, `${app}.${ext}`)
      if (existsSync(f)) {
        ctx.sys.systemctl(paths.engine, ['stop', basename(f)], quiet)
        ctx.sys.systemctl(paths.engine, ['disable', basename(f)], quiet)
      }
    }
  }

  // Flat leftovers (`<app>.*`) and per-unit install dirs (`<unit>/`).
  try {
    for (const n of readdirSync(paths.dest)) {
      if (n.startsWith(`${app}.`)) rmSync(join(paths.dest, n), { recursive: true, force: true })
    }
  } catch {
    // dest missing
  }
  if (d) {
    for (const udir of listUnitDirs(d)) {
      rmSync(join(paths.dest, unitInstallName(udir)), { recursive: true, force: true })
    }
  } else {
    // Orphan: best-effort remove dest/<app>/ when present.
    rmSync(join(paths.dest, app), { recursive: true, force: true })
  }
  rmSync(join(paths.sysDest, `${app}.service`), { force: true })
  rmSync(join(paths.sysDest, `${app}.timer`), { force: true })
  unmarkEnabled(app, paths.dest)
}

/**
 * Remove an empty dir, ignoring errors (like `rmdir 2>/dev/null || true`).
 * @param {string} dir
 */
export function rmdirQuiet(dir) {
  try {
    rmdirSync(dir)
  } catch {
    // not empty / missing
  }
}
