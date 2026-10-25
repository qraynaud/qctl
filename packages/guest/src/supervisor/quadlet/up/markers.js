/**
 * Collect enabled markers and register repo apps for `quadlet up`.
 */
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  appDir,
  appHasUnits,
  expandUnitDepApps,
  globExts,
  listRepoApps,
  markEnabled,
  markerDir,
  markerEngine,
  readEngine,
} from '../apps/index.js'
import { die } from '../errors.js'
import { markerAlready } from './session.js'
/** @import { Engine, EnginePaths } from '../system.js' */
/** @import { UpSession } from './session.js' */

/**
 * @param {UpSession} s
 * @param {EnginePaths} paths
 * @param {Engine} defaultEngine
 */
export function collectMarkersFrom(s, paths, defaultEngine) {
  const { ctx, dry, filtered, appFilters } = s
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
  if (!dry && !filtered && listMarkers().length === 0) {
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
    if (filtered && !appFilters.has(app)) continue
    const marker = join(d, app)
    const e = markerEngine(marker)
    s.markers.push({
      marker,
      app,
      engine: e === 'rootless' || e === 'rootful' ? e : defaultEngine,
    })
  }
}

/**
 * @param {UpSession} s
 */
export function registerRepoApps(s) {
  const { ctx, dry, filtered, filterList } = s
  if (filtered) {
    for (const appFilter of filterList) {
      const dir = appDir(ctx, appFilter)
      if (!dir) {
        if (markerAlready(s, appFilter)) continue
        die(`unknown app '${appFilter}' (no applications/${appFilter}/app.yaml)`)
      }
      // Companions from unit After=/Wants=/… first, then the target app.
      for (const name of expandUnitDepApps(ctx, appFilter)) {
        if (markerAlready(s, name)) continue
        const ddir = appDir(ctx, name)
        if (!ddir) die(`unit dep: unknown app '${name}' (from ${appFilter})`)
        if (!appHasUnits(ddir)) {
          if (!dry) ctx.log(`skip ${name} (no units)`)
          continue
        }
        s.markers.push({ marker: '', app: name, engine: readEngine(ddir) })
      }
      if (markerAlready(s, appFilter)) continue
      if (!appHasUnits(dir)) {
        if (!dry) ctx.log(`skip ${appFilter} (no units)`)
        continue
      }
      s.markers.push({ marker: '', app: appFilter, engine: readEngine(dir) })
    }
    return
  }
  for (const name of listRepoApps(ctx)) {
    if (markerAlready(s, name)) continue
    const dir = appDir(ctx, name)
    if (!dir || !appHasUnits(dir)) continue
    s.markers.push({ marker: '', app: name, engine: readEngine(dir) })
  }
}

/**
 * Seed markers from install dirs, then register missing repo apps.
 * @param {UpSession} s
 */
export function collectAndRegister(s) {
  collectMarkersFrom(s, s.ctx.sys.paths('rootless'), 'rootless')
  collectMarkersFrom(s, s.ctx.sys.paths('rootful'), 'rootful')
  registerRepoApps(s)
}
