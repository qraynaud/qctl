import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { die } from '../errors.js'
import { MARKER_DIR } from './constants.js'
import { appDir, readEngine } from './discovery.js'
/** @import { QuadletContext } from '../context.js' */
/** @import { EnginePaths } from '../system.js' */

/**
 * @param {string} dest
 * @returns {string}
 */
export function markerDir(dest) {
  return join(dest, MARKER_DIR)
}

/**
 * @param {QuadletContext} ctx
 * @param {string} app
 * @param {EnginePaths} paths
 */
export function markEnabled(ctx, app, paths) {
  const d = markerDir(paths.dest)
  mkdirSync(d, { recursive: true })
  const f = join(d, app)
  writeFileSync(f, `# managed by qctl quadlet\napp=${app}\nengine=${paths.engine}\n`)
  ctx.sys.chown(paths.engine, d)
  ctx.sys.chown(paths.engine, f)
}

/**
 * @param {string} app
 * @param {string} dest
 */
export function unmarkEnabled(app, dest) {
  rmSync(join(markerDir(dest), app), { force: true })
}

/**
 * @param {string} marker file path
 * @returns {string} engine or ""
 */
export function markerEngine(marker) {
  for (const line of readFileSync(marker, 'utf8').split('\n')) {
    if (line.startsWith('engine=')) return line.slice('engine='.length)
  }
  return ''
}

/**
 * Locate an app's engine: marker first (rootless then rootful), else app.yaml.
 * @param {QuadletContext} ctx
 * @param {string} app
 * @returns {EnginePaths}
 */
export function resolveAppEngine(ctx, app) {
  for (const probe of /** @type {const} */ (['rootless', 'rootful'])) {
    const paths = ctx.sys.paths(probe)
    const marker = join(markerDir(paths.dest), app)
    if (existsSync(marker)) {
      const e = markerEngine(marker)
      return e === 'rootless' || e === 'rootful' ? ctx.sys.paths(e) : paths
    }
  }
  const d = appDir(ctx, app)
  if (!d) die(`app '${app}' not installed and not in applications/`)
  return ctx.sys.paths(readEngine(d))
}
