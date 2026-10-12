/**
 * App unit diff (dry) and reconcile (apply) for `quadlet up`.
 */
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  QUADLET_EXTS,
  SYSTEMD_EXTS,
  appDir,
  globExts,
  listUnitDirs,
  markEnabled,
  packageUnitFiles,
  readEngine,
  stopAndRemoveApp,
} from '../apps/index.js'
import { loadRenderEnv, runtimeUnitDirs } from '../env.js'
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
} from '../install.js'
import { networkRefsFromFile } from '../networks.js'
import { markRestart, noteEngine, plan } from './session.js'
/** @import { QuadletContext } from '../context.js' */
/** @import { RenderEnv } from '../env.js' */
/** @import { Engine, EnginePaths } from '../system.js' */
/** @import { UpSession } from './session.js' */

/**
 * @param {QuadletContext} ctx
 * @param {string} dir
 * @param {EnginePaths} paths
 * @param {RenderEnv} renv
 * @returns {Promise<boolean>}
 */
export async function appUnitsDiffer(ctx, dir, paths, renv) {
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

/**
 * @param {UpSession} s
 * @param {string} app
 * @param {Engine} engineIn
 * @param {boolean} isNew
 * @returns {Promise<void>}
 */
export async function reconcileApp(s, app, engineIn, isNew) {
  const { ctx } = s
  let engine = engineIn
  let paths = ctx.sys.paths(engine)
  noteEngine(s, engine)
  mkdirSync(paths.dest, { recursive: true })
  mkdirSync(paths.sysDest, { recursive: true })
  ctx.sys.chown(engine, paths.dest)
  ctx.sys.chown(engine, paths.sysDest)

  const dir = appDir(ctx, app)
  if (!dir) {
    ctx.log(`remove orphan ${app} (${engine})`)
    stopAndRemoveApp(ctx, app, paths)
    s.needReload = true
    return
  }

  const repoEngine = readEngine(dir)
  if (repoEngine !== engine) {
    ctx.log(`engine change ${app}: ${engine} → ${repoEngine}`)
    engine = repoEngine
    paths = ctx.sys.paths(engine)
    noteEngine(s, engine)
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
    markRestart(s, app)
    s.needReload = true
  } else {
    ctx.log(`unchanged ${app} (${engine})`)
  }
  markEnabled(ctx, app, paths)
}

/**
 * Dry-run: plan add/update/remove for each marker (networks already scanned).
 * @param {UpSession} s
 * @returns {Promise<void>}
 */
export async function planApps(s) {
  const { ctx, markers, dirtyNetworks } = s
  for (const base of dirtyNetworks) plan(s, 'update', base)

  for (const m of markers) {
    const dir = appDir(ctx, m.app)
    if (!dir) {
      plan(s, 'remove', m.app)
      continue
    }
    const repoEngine = readEngine(dir)
    const paths = ctx.sys.paths(repoEngine)
    if (!m.marker) {
      plan(s, 'add', m.app)
      continue
    }
    const renv = await loadRenderEnv(ctx, dir)
    if (await appUnitsDiffer(ctx, dir, paths, renv)) plan(s, 'update', m.app)
  }
}

/**
 * Apply: reconcile each marker (install/update/remove units).
 * @param {UpSession} s
 * @returns {Promise<void>}
 */
export async function reconcileApps(s) {
  const { ctx, markers } = s
  if (markers.length === 0) {
    ctx.log('no apps to reconcile')
    return
  }
  for (const m of markers) await reconcileApp(s, m.app, m.engine, m.marker === '')
}
