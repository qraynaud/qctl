/**
 * `quadlet up`: reconcile installed Quadlets with the repo (compose-up-ish).
 * Down orphans, update changed apps, register new ones; `--dry-run` only plans.
 */
import { collectAndRegister } from './markers.js'
import {
  installSharedNetworks,
  pruneOrphansForFilter,
  recreateDirtyNetworks,
  restartAppsUsingDirtyNetworks,
} from './networks.js'
import { planApps, reconcileApps } from './reconcile.js'
import { logUpDone, reloadDaemons, restartChangedApps, startFilteredIfNeeded } from './restart.js'
import { createUpSession } from './session.js'
/** @import { QuadletContext } from '../context.js' */

/**
 * @param {QuadletContext} ctx
 * @param {{ dryRun?: boolean, app?: string, apps?: string[] }} [opts]
 * @returns {Promise<void>}
 */
export async function runUp(ctx, opts = {}) {
  const s = createUpSession(ctx, opts)

  collectAndRegister(s)

  // Shared networks before apps (same for dry plan and apply).
  await installSharedNetworks(s)

  if (s.dry) {
    await planApps(s)
    restartAppsUsingDirtyNetworks(s)
    pruneOrphansForFilter(s)
    if (s.dryActions === 0) ctx.print('nothing to do')
    return
  }

  await reconcileApps(s)
  if (s.markers.length > 0) restartAppsUsingDirtyNetworks(s)
  pruneOrphansForFilter(s)

  reloadDaemons(s)
  // Podman does not mutate an existing network when the Quadlet .network file
  // changes. Stop consumers, rm, start unit.
  recreateDirtyNetworks(s)
  const restartList = restartChangedApps(s)
  startFilteredIfNeeded(s)
  logUpDone(s, restartList)
}
