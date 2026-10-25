/**
 * File installation helpers: render/write with chown, change detection, autostart drop-ins.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { rmdirQuiet, unitInstallName } from './apps/index.js'
import { rewritePeerServiceDeps } from './apps/rewrite.js'
import { renderFile, renderUnitEnvFile } from './env.js'
import { die } from './errors.js'

/** @import { QuadletContext } from './context.js' */
/** @import { RenderEnv } from './env.js' */
/** @import { Engine, EnginePaths } from './system.js' */

/**
 * @param {string} dest
 * @param {string} content
 */
function atomicWrite(dest, content) {
  mkdirSync(dirname(dest), { recursive: true })
  const tmp = join(dirname(dest), `.${basename(dest)}.qctl-tmp`)
  writeFileSync(tmp, content)
  chmodSync(tmp, 0o644)
  renameSync(tmp, dest)
}

/**
 * @param {string} dest
 * @param {string} content
 * @returns {boolean} true when differs / missing
 */
function differs(dest, content) {
  if (!existsSync(dest)) return true
  return readFileSync(dest, 'utf8') !== content
}

/**
 * Install path for a unit directory: `dest/<unit>/`.
 * @param {EnginePaths} paths
 * @param {string} unitDir
 * @returns {string}
 */
export function unitInstallDir(paths, unitDir) {
  return join(paths.dest, unitInstallName(unitDir))
}

/**
 * Render a unit template and rewrite cross-engine peer deps to `qctl-app@…`.
 * @param {QuadletContext} ctx
 * @param {string} src
 * @param {RenderEnv} renv
 * @param {Engine} engine engine of the app/network being installed
 * @returns {string}
 */
export function renderInstalledUnit(ctx, src, renv, engine) {
  return rewritePeerServiceDeps(renderFile(src, renv), ctx, engine)
}

/**
 * Always write rendered template to dest (0644, chown for rootless).
 * @param {QuadletContext} ctx
 * @param {EnginePaths} paths
 * @param {string} src
 * @param {string} dest
 * @param {RenderEnv} renv
 */
export function renderToFile(ctx, paths, src, dest, renv) {
  atomicWrite(dest, renderInstalledUnit(ctx, src, renv, paths.engine))
  ctx.sys.chown(paths.engine, dest)
}

/**
 * Write unit `EnvironmentFile=.env` from the unit graph.
 * @param {QuadletContext} ctx
 * @param {EnginePaths} paths
 * @param {string} unitDir
 * @param {string} dest
 * @param {RenderEnv} packageRenv
 * @returns {Promise<void>}
 */
export async function renderUnitEnvToFile(ctx, paths, unitDir, dest, packageRenv) {
  atomicWrite(dest, await renderUnitEnvFile(unitDir, packageRenv, ctx))
  ctx.sys.chown(paths.engine, dest)
}

/**
 * Template differs from installed dest?
 * @param {QuadletContext} ctx
 * @param {string} src
 * @param {string} dest
 * @param {RenderEnv} renv
 * @param {Engine} engine
 * @returns {boolean}
 */
export function templateDiffers(ctx, src, dest, renv, engine) {
  return differs(dest, renderInstalledUnit(ctx, src, renv, engine))
}

/**
 * Unit `.env` differs from what would be installed?
 * @param {string} unitDir
 * @param {string} dest
 * @param {RenderEnv} packageRenv
 * @param {QuadletContext} ctx
 * @returns {Promise<boolean>}
 */
export async function unitEnvDiffers(unitDir, dest, packageRenv, ctx) {
  return differs(dest, await renderUnitEnvFile(unitDir, packageRenv, ctx))
}

/**
 * Install rendered template only if content changed.
 * @param {QuadletContext} ctx
 * @param {EnginePaths} paths
 * @param {string} src
 * @param {string} dest
 * @param {RenderEnv} renv
 * @returns {boolean} true when written
 */
export function installIfChanged(ctx, paths, src, dest, renv) {
  const content = renderInstalledUnit(ctx, src, renv, paths.engine)
  if (!differs(dest, content)) return false
  atomicWrite(dest, content)
  ctx.sys.chown(paths.engine, dest)
  return true
}

/**
 * Install unit `.env` only if content changed.
 * @param {QuadletContext} ctx
 * @param {EnginePaths} paths
 * @param {string} unitDir
 * @param {string} dest
 * @param {RenderEnv} packageRenv
 * @returns {Promise<boolean>}
 */
export async function installUnitEnvIfChanged(ctx, paths, unitDir, dest, packageRenv) {
  const content = await renderUnitEnvFile(unitDir, packageRenv, ctx)
  if (!differs(dest, content)) return false
  atomicWrite(dest, content)
  ctx.sys.chown(paths.engine, dest)
  return true
}

/**
 * Symlink top-level `*.network` files into a unit install dir so `Network=foo.network`
 * resolves when the Quadlet unit lives in a subdirectory.
 * @param {QuadletContext} ctx
 * @param {EnginePaths} paths
 * @param {string} unitDest  `dest/<unit>`
 * @param {string[]} networkBasenames  e.g. `["shared.network", "web.network"]`
 */
export function linkTopLevelNetworks(ctx, paths, unitDest, networkBasenames) {
  mkdirSync(unitDest, { recursive: true })
  for (const base of networkBasenames) {
    const name = base.endsWith('.network') ? base : `${base}.network`
    const top = join(paths.dest, name)
    const link = join(unitDest, name)
    if (!existsSync(top) || existsSync(link)) continue
    symlinkSync(join('..', name), link)
    ctx.sys.chown(paths.engine, link)
  }
}

// --- autostart drop-in -----------------------------------------------------

/**
 * @param {string} base unit basename
 * @returns {boolean}
 */
export function wantsAutostart(base) {
  return /\.(container|pod|kube)$/.test(base)
}

/**
 * @param {Engine} engine
 * @returns {string}
 */
export function autostartBody(engine) {
  let wanted
  if (engine === 'rootless') wanted = 'default.target'
  else if (engine === 'rootful') wanted = 'multi-user.target'
  else die(`bad engine '${String(engine)}' for autostart`)
  return `# Written by quadlet enable|up — omit with --no-install\n[Install]\nWantedBy=${wanted}\n`
}

/**
 * Create/remove `<unit>.d/autostart.conf`. Returns true if the filesystem changed.
 * @param {QuadletContext} ctx
 * @param {EnginePaths} paths
 * @param {string} unitPath installed unit
 * @param {boolean} install
 * @returns {boolean}
 */
export function syncAutostart(ctx, paths, unitPath, install) {
  if (!wantsAutostart(basename(unitPath))) return false
  const dropdir = `${unitPath}.d`
  const drop = join(dropdir, 'autostart.conf')
  if (install) {
    const body = autostartBody(paths.engine)
    if (existsSync(drop) && readFileSync(drop, 'utf8') === body) return false
    mkdirSync(dropdir, { recursive: true })
    writeFileSync(drop, body)
    chmodSync(drop, 0o644)
    ctx.sys.chown(paths.engine, dropdir)
    ctx.sys.chown(paths.engine, drop)
    return true
  }
  if (existsSync(drop)) {
    rmSync(drop, { force: true })
    rmdirQuiet(dropdir)
    return true
  }
  return false
}

/**
 * Does the installed autostart drop-in differ from what `up` would write?
 * @param {string} unitPath installed unit
 * @param {Engine} engine
 * @returns {boolean}
 */
export function autostartDiffers(unitPath, engine) {
  const drop = join(`${unitPath}.d`, 'autostart.conf')
  return !existsSync(drop) || readFileSync(drop, 'utf8') !== autostartBody(engine)
}
