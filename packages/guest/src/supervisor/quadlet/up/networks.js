/**
 * Shared-network install, orphan prune, and dirty-network recreate for `quadlet up`.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

import { appDir, appServiceNames, globExts, readEngine } from '../apps/index.js'
import { loadNetworkRenderEnv } from '../env.js'
import { installIfChanged, templateDiffers } from '../install.js'
import {
  appNetworkRefs,
  appUsesNetworks,
  installNetworkHostMacvlan,
  listSharedNetworkFiles,
  networkLiveStale,
  networkSharedEngine,
  networksSrc,
  recreatePodmanNetwork,
  removeNetworkUnit,
  sharedNetworkFile,
} from '../networks.js'
import { markRestart, noteDirtyNetwork, noteEngine, plan, will } from './session.js'
/** @import { Engine } from '../system.js' */
/** @import { UpSession } from './session.js' */

/**
 * Wanted .network basenames for `engine` given markers (repo truth).
 * @param {UpSession} s
 * @param {Engine} engine
 * @returns {Set<string>}
 */
export function wantedNetworkBasenames(s, engine) {
  const { ctx, markers } = s
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

/**
 * Remove installed .network units no longer shipped.
 * @param {UpSession} s
 * @param {Engine} engine
 */
export async function pruneOrphanNetworks(s, engine) {
  const { ctx, dry } = s
  const paths = ctx.sys.paths(engine)
  if (!existsSync(paths.dest)) return
  const want = wantedNetworkBasenames(s, engine)
  for (const base of readdirSync(paths.dest)
    .filter((n) => n.endsWith('.network'))
    .sort()) {
    if (want.has(base)) continue
    if (dry) {
      will(s, 'remove', base)
      continue
    }
    ctx.log(`remove orphan network ${base} (${engine})`)
    await removeNetworkUnit(ctx, paths, base)
    s.needReload = true
    noteEngine(s, engine)
  }
}

/**
 * @param {UpSession} s
 */
export async function pruneOrphansForFilter(s) {
  const { ctx, filtered, filterList } = s
  if (!filtered) {
    await pruneOrphanNetworks(s, 'rootless')
    await pruneOrphanNetworks(s, 'rootful')
    return
  }
  /** @type {Set<Engine>} */
  const engines = new Set()
  for (const name of filterList) {
    const dir = appDir(ctx, name)
    if (dir) engines.add(readEngine(dir))
  }
  if (engines.size === 0) {
    await pruneOrphanNetworks(s, 'rootless')
    await pruneOrphanNetworks(s, 'rootful')
    return
  }
  for (const eng of engines) await pruneOrphanNetworks(s, eng)
}

/**
 * Install/update shared networks/<name>/ Quadlets (rootless bridges + rootful macvlan/ipvlan).
 * @param {UpSession} s
 * @returns {Promise<void>}
 */
export async function installSharedNetworks(s) {
  const { ctx, dry, filtered, markers } = s
  if (!networksSrc(ctx)) return
  /** @type {Set<string>} */
  const wantRootless = new Set()
  /** @type {Set<string>} */
  const wantRootful = new Set()

  if (!filtered) {
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
        if (templateDiffers(ctx, f, dest, renv, paths.engine)) noteDirtyNetwork(s, base)
        else if (existsSync(dest) && (await networkLiveStale(ctx, paths, dest))) {
          noteDirtyNetwork(s, base)
        }
        continue
      }
      if (installIfChanged(ctx, paths, f, dest, renv)) {
        ctx.log(`updated ${dest} (${engine} shared)`)
        noteDirtyNetwork(s, base)
        s.needReload = true
        noteEngine(s, engine)
      } else if (existsSync(dest) && (await networkLiveStale(ctx, paths, dest))) {
        ctx.log(`stale podman network vs ${dest} (${engine}) — will recreate`)
        noteDirtyNetwork(s, base)
        noteEngine(s, engine)
      }
      // Host macvlan shim — reconcile when the package ships it.
      try {
        await installNetworkHostMacvlan(ctx, paths, f, renv)
      } catch (e) {
        ctx.log(`warning: host macvlan for ${base}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  await installFor('rootless', wantRootless)
  await installFor('rootful', wantRootful)
}

/**
 * Mark/plan restarts for apps that consume dirty shared networks.
 * @param {UpSession} s
 */
export function restartAppsUsingDirtyNetworks(s) {
  const { ctx, dry, markers, dirtyNetworks } = s
  if (dirtyNetworks.length === 0) return
  for (const m of markers) {
    const dir = appDir(ctx, m.app)
    if (!dir) continue
    if (!appUsesNetworks(dir, dirtyNetworks)) continue
    if (dry) plan(s, 'restart', m.app)
    else markRestart(s, m.app)
  }
}

/**
 * Stop consumers, recreate dirty Podman networks from Quadlet units.
 * @param {UpSession} s
 */
export async function recreateDirtyNetworks(s) {
  const { ctx, markers, dirtyNetworks } = s
  if (dirtyNetworks.length === 0) return
  for (const m of markers) {
    const dir = appDir(ctx, m.app)
    if (!dir) continue
    if (!appUsesNetworks(dir, dirtyNetworks)) continue
    markRestart(s, m.app)
    const engine = readEngine(dir)
    if (engine === 'rootless') ctx.sys.ensureRootlessBus()
    for (const svc of appServiceNames(dir)) {
      ctx.log(`stop ${svc} (${engine}; network recreate)`)
      await ctx.sys.systemctl(engine, ['stop', svc], { ignoreStderr: true })
    }
  }
  for (const base of dirtyNetworks) {
    const f = sharedNetworkFile(ctx, base)
    if (!f) continue
    const eng = networkSharedEngine(f)
    const paths = ctx.sys.paths(eng)
    if (eng === 'rootless') ctx.sys.ensureRootlessBus()
    if (!(await recreatePodmanNetwork(ctx, paths, base))) {
      ctx.log(`warning: could not recreate ${base} (${eng})`)
    }
  }
}
