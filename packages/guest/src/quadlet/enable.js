/**
 * `quadlet enable <apps…>`: render apps' units into containers/systemd.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import {
  QUADLET_EXTS,
  SYSTEMD_EXTS,
  appDir,
  globExts,
  listUnitDirs,
  markEnabled,
  packageUnitFiles,
  readEngine,
  resolveAppName,
  unmarkEnabled,
} from './apps/index.js'
import { loadNetworkRenderEnv, loadRenderEnv, runtimeUnitDirs } from './env.js'
import { die } from './errors.js'
import {
  linkTopLevelNetworks,
  renderToFile,
  renderUnitEnvToFile,
  syncAutostart,
  templateDiffers,
  unitInstallDir,
} from './install.js'
import {
  installNetworkHostMacvlan,
  listSharedNetworkFiles,
  networkLiveStale,
  networkRefsFromFile,
  networkSharedEngine,
  recreatePodmanNetwork,
} from './networks.js'
/** @import { QuadletContext } from './context.js' */

/**
 * @param {QuadletContext} ctx
 * @param {{ app: string, install?: boolean }} opts
 * @returns {Promise<void>}
 */
export async function runEnable(ctx, opts) {
  const install = opts.install !== false
  const name = resolveAppName(opts.app)
  const dir = appDir(ctx, name)
  if (!dir) die(`unknown app '${name}' (no applications/${name}/app.yaml)`)

  const renv = await loadRenderEnv(ctx, dir)
  const engine = readEngine(dir)
  const paths = ctx.sys.paths(engine)
  mkdirSync(paths.dest, { recursive: true })
  mkdirSync(paths.sysDest, { recursive: true })
  ctx.sys.chown(engine, dirname(paths.dest))
  ctx.sys.chown(engine, paths.dest)
  ctx.sys.chown(engine, paths.sysDest)

  if (engine === 'rootless') ctx.sys.ensureRootlessBus()

  const sharedQuadlets = globExts(dir, QUADLET_EXTS)
  const unitDirs = listUnitDirs(dir)
  const sysunits = packageUnitFiles(dir, SYSTEMD_EXTS)
  const envUnits = runtimeUnitDirs(dir)

  if (sharedQuadlets.length === 0 && unitDirs.length === 0 && sysunits.length === 0) {
    ctx.print(`${engine}: ${dir} has no units (config/scripts only) — nothing to install`)
    return
  }

  // Package-root shared Quadlets → dest top-level.
  for (const unit of sharedQuadlets) {
    const dest = join(paths.dest, basename(unit))
    renderToFile(ctx, paths, unit, dest, renv)
    ctx.print(`${engine}: rendered ${dest}`)
    if (syncAutostart(ctx, paths, dest, install)) {
      ctx.print(
        install
          ? `${engine}: autostart ${dest}.d/autostart.conf (WantedBy=${paths.wantedBy})`
          : `${engine}: removed ${dest}.d/autostart.conf (--no-install)`,
      )
    }
  }

  // Shared networks/<name>/ for this engine (macvlan/ipvlan → rootful; else rootless).
  let sharedNets = false
  /** @type {string[]} */
  const recreateNets = []
  for (const net of listSharedNetworkFiles(ctx)) {
    if (networkSharedEngine(net) !== engine) continue
    const dest = join(paths.dest, basename(net))
    const nenv = await loadNetworkRenderEnv(ctx, net)
    const needRecreate =
      !existsSync(dest) || templateDiffers(net, dest, nenv) || networkLiveStale(ctx, paths, dest)
    renderToFile(ctx, paths, net, dest, nenv)
    ctx.print(`${engine}: rendered ${dest} (shared)`)
    if (needRecreate) recreateNets.push(basename(net))
    try {
      if (installNetworkHostMacvlan(ctx, paths, net, nenv)) {
        ctx.print(`${engine}: host macvlan for ${basename(net, '.network')}`)
      }
    } catch {
      // best effort, like the old `2>/dev/null`
    }
    sharedNets = true
  }

  // Unit subdirs → dest/<unit>/ + EnvironmentFile=.env; symlink top-level networks.
  for (const udir of unitDirs) {
    const unitDest = unitInstallDir(paths, udir)
    mkdirSync(unitDest, { recursive: true })
    ctx.sys.chown(engine, unitDest)
    /** @type {string[]} */
    const netRefs = []
    for (const unit of globExts(udir, QUADLET_EXTS)) {
      const dest = join(unitDest, basename(unit))
      renderToFile(ctx, paths, unit, dest, renv)
      ctx.print(`${engine}: rendered ${dest}`)
      if (syncAutostart(ctx, paths, dest, install)) {
        ctx.print(
          install
            ? `${engine}: autostart ${dest}.d/autostart.conf (WantedBy=${paths.wantedBy})`
            : `${engine}: removed ${dest}.d/autostart.conf (--no-install)`,
        )
      }
      netRefs.push(...networkRefsFromFile(unit))
    }
    linkTopLevelNetworks(ctx, paths, unitDest, [...new Set(netRefs)])
  }
  for (const udir of envUnits) {
    const dest = join(unitInstallDir(paths, udir), '.env')
    await renderUnitEnvToFile(ctx, paths, udir, dest, renv)
    ctx.print(`${engine}: rendered ${dest}`)
  }

  for (const unit of sysunits) {
    const dest = join(paths.sysDest, basename(unit))
    renderToFile(ctx, paths, unit, dest, renv)
    ctx.print(`${engine}: rendered ${dest}`)
  }

  if (
    sharedQuadlets.length > 0
    || unitDirs.length > 0
    || envUnits.length > 0
    || sysunits.length > 0
    || sharedNets
  ) {
    ctx.sys.systemctl(engine, ['daemon-reload'])
  }
  for (const base of recreateNets) {
    if (recreatePodmanNetwork(ctx, paths, base)) {
      ctx.print(`${engine}: recreated podman network ${base}`)
    }
  }

  if (install) markEnabled(ctx, name, paths)
  else unmarkEnabled(name, paths.dest)

  ctx.print(`engine=${engine} owner=${paths.asUser ?? 'root'}`)
  ctx.print(`dest=${paths.dest}`)
  ctx.print(`env=${renv.qctlEnv} (varlock graph: ${join(dir, '.env.schema')})`)
  if (renv.appEnvLabel) ctx.print(`app_env=${renv.appEnvLabel}`)
  ctx.print(`APP_ROOT=${renv.scope.APP_ROOT ?? '?'}`)
  ctx.print(`instance=${ctx.root}`)
  ctx.print(
    install
      ? `install=autostart drop-in (WantedBy=${paths.wantedBy})`
      : 'install=skipped (--no-install)',
  )

  /** @type {string} */
  let unit = ''
  if (sysunits.length > 0) {
    const timer = packageUnitFiles(dir, ['timer'])[0]
    unit = basename(timer ?? /** @type {string} */ (sysunits[0]))
  } else {
    const containers = packageUnitFiles(dir, ['container'])
    if (containers.length > 0) {
      unit = `${basename(/** @type {string} */ (containers[0])).replace(/\.[^.]*$/, '')}.service`
    }
  }
  if (unit) {
    ctx.print(`Start with: qctl quadlet start ${name}`)
    ctx.print(`(Quadlet [Install] from *.d/autostart.conf → ${paths.wantedBy}; unit ${unit})`)
  }
}
