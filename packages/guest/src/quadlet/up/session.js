/**
 * Shared mutable state for one `quadlet up` run (dry or apply).
 */
import { resolveAppName } from '../apps/index.js'
/** @import { QuadletContext } from '../context.js' */
/** @import { Engine } from '../system.js' */

/**
 * @typedef {object} UpEntry
 * @property {string} marker  marker file path ("" = new app, not yet registered)
 * @property {string} app
 * @property {Engine} engine
 */

/**
 * @typedef {object} UpSession
 * @property {QuadletContext} ctx
 * @property {boolean} dry
 * @property {boolean} filtered
 * @property {Set<string>} appFilters
 * @property {string[]} filterList
 * @property {UpEntry[]} markers
 * @property {string[]} restartApps
 * @property {Engine[]} reloadEngines
 * @property {string[]} dirtyNetworks
 * @property {boolean} needReload
 * @property {number} dryActions
 * @property {Set<string>} planned
 */

/**
 * @param {QuadletContext} ctx
 * @param {{ dryRun?: boolean, app?: string, apps?: string[] }} [opts]
 * @returns {UpSession}
 */
export function createUpSession(ctx, opts = {}) {
  /** @type {Set<string>} */
  const appFilters = new Set()
  const rawApps = opts.apps?.length ? opts.apps : opts.app ? [opts.app] : []
  for (const a of rawApps) appFilters.add(resolveAppName(a))
  return {
    ctx,
    dry: Boolean(opts.dryRun),
    filtered: appFilters.size > 0,
    appFilters,
    filterList: [...appFilters].sort(),
    markers: [],
    restartApps: [],
    reloadEngines: [],
    dirtyNetworks: [],
    needReload: false,
    dryActions: 0,
    planned: new Set(),
  }
}

/**
 * @param {UpSession} s
 * @param {string} action
 * @param {string} name
 */
export function will(s, action, name) {
  s.ctx.print(`will ${action} ${name}`)
  s.dryActions++
}

/**
 * Deduped dry-run plan line.
 * @param {UpSession} s
 * @param {string} action
 * @param {string} name
 */
export function plan(s, action, name) {
  const key = `${action}:${name}`
  if (s.planned.has(key)) return
  s.planned.add(key)
  will(s, action, name)
}

/**
 * @param {UpSession} s
 * @param {string} app
 */
export function markRestart(s, app) {
  if (!s.restartApps.includes(app)) s.restartApps.push(app)
}

/**
 * @param {UpSession} s
 * @param {Engine} e
 */
export function noteEngine(s, e) {
  if (!s.reloadEngines.includes(e)) s.reloadEngines.push(e)
}

/**
 * @param {UpSession} s
 * @param {string} base
 */
export function noteDirtyNetwork(s, base) {
  if (!s.dirtyNetworks.includes(base)) s.dirtyNetworks.push(base)
}

/**
 * @param {UpSession} s
 * @param {string} app
 * @returns {boolean}
 */
export function markerAlready(s, app) {
  return s.markers.some((m) => m.app === app)
}
