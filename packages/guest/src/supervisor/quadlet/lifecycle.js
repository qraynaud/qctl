/**
 * `quadlet start | stop | restart | down | ps`.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  appDir,
  appServiceNames,
  appSystemctl,
  containerName,
  globExts,
  listUnitDirs,
  markerDir,
  markerEngine,
  packageUnitFiles,
  readEngine,
  resolveAppEngine,
  resolveAppName,
  stopAndRemoveApp,
  unitInstallName,
  unitValue,
} from './apps/index.js'
import { die } from './errors.js'

/** @import { QuadletContext } from './context.js' */
/** @import { Engine } from './system.js' */

/**
 * Installed `*.container` paths under a Quadlet dest (top-level + unit subdirs).
 * @param {string} dest
 * @returns {string[]}
 */
function installedContainers(dest) {
  /** @type {string[]} */
  const out = [...globExts(dest, ['container'])]
  try {
    for (const n of readdirSync(dest)) {
      if (n.startsWith('.')) continue
      const sub = join(dest, n)
      try {
        if (statSync(sub).isDirectory()) out.push(...globExts(sub, ['container']))
      } catch {
        // dangling
      }
    }
  } catch {
    // dest missing
  }
  return out
}

/**
 * @param {QuadletContext} ctx
 * @param {'start' | 'stop'} action
 * @param {string} appArg
 */
export async function runStartStop(ctx, action, appArg) {
  const app = resolveAppName(appArg)
  const paths = resolveAppEngine(ctx, app)
  await appSystemctl(ctx, action, app, paths)
  ctx.log(`done (${action} ${app})`)
}

/**
 * Restart: start if inactive and not failed; reset-failed first.
 * @param {QuadletContext} ctx
 * @param {string} appArg
 */
export async function runRestart(ctx, appArg) {
  const app = resolveAppName(appArg)
  const paths = resolveAppEngine(ctx, app)
  const dir = appDir(ctx, app)
  if (!dir) die(`unknown app '${app}' (no applications/${app}/app.yaml)`)
  if (paths.engine === 'rootless') ctx.sys.ensureRootlessBus()

  const svcs = appServiceNames(dir)
  if (svcs.length === 0) die(`app '${app}' has no startable units`)
  for (const svc of svcs) {
    ctx.log(`restart ${svc} (${paths.engine})`)
    // Clear start-limit / failed state so a prior ExecStartPre failure can retry.
    await ctx.sys.systemctl(paths.engine, ['reset-failed', svc], { ignoreStderr: true })
    const active =
      (await ctx.sys.systemctl(paths.engine, ['is-active', '--quiet', svc], { capture: true }))
        .status === 0
    const failed =
      !active
      && (await ctx.sys.systemctl(paths.engine, ['is-failed', '--quiet', svc], { capture: true }))
        .status === 0
    const verb = active || failed ? 'restart' : 'start'
    const r = await ctx.sys.systemctl(paths.engine, [verb, svc])
    if (r.status !== 0) die(`systemctl ${verb} ${svc} failed (exit ${r.status})`)
  }
  ctx.log(`done (restart ${app})`)
}

/**
 * Stop + remove installed units for one app (data stays).
 * @param {QuadletContext} ctx
 * @param {string} appArg
 */
export async function runDown(ctx, appArg) {
  const app = resolveAppName(appArg)

  /** @type {Engine | ""} */
  let engine = ''
  for (const probe of /** @type {const} */ (['rootless', 'rootful'])) {
    const paths = ctx.sys.paths(probe)
    const marker = join(markerDir(paths.dest), app)
    if (existsSync(marker)) {
      const e = markerEngine(marker)
      engine = e === 'rootless' || e === 'rootful' ? e : probe
      break
    }
  }

  if (!engine) {
    const dir = appDir(ctx, app)
    if (dir) {
      engine = readEngine(dir)
    } else {
      // Last resort: remove from whichever tree has files.
      let found = false
      for (const probe of /** @type {const} */ (['rootless', 'rootful'])) {
        const paths = ctx.sys.paths(probe)
        const has = [paths.dest, paths.sysDest].some((d) => {
          try {
            return readdirSync(d).some((n) => n.startsWith(`${app}.`))
          } catch {
            return false
          }
        })
        if (has) {
          found = true
          ctx.log(`down ${app} (${probe})`)
          await stopAndRemoveApp(ctx, app, paths)
          await ctx.sys.systemctl(probe, ['daemon-reload'])
        }
      }
      if (!found) die(`app '${app}' not installed and not in repo`)
      ctx.log(`done (down ${app})`)
      return
    }
  }

  const paths = ctx.sys.paths(engine)
  ctx.log(`down ${app} (${engine})`)
  await stopAndRemoveApp(ctx, app, paths)
  await ctx.sys.systemctl(engine, ['daemon-reload'])
  ctx.log(`done (down ${app})`)
}

// --- ps ----------------------------------------------------------------------

/**
 * ENGINE/NAMES/STATUS/IMAGE row for an installed .container unit. Uses podman status
 * when the container exists; otherwise systemd unit state (Quadlet uses --rm).
 * @param {QuadletContext} ctx
 * @param {Engine} engine
 * @param {string} unitFile
 * @returns {Promise<string[]>}
 */
export async function psUnitRow(ctx, engine, unitFile) {
  const svc = `${basename(unitFile, '.container')}.service`
  const name = containerName(unitFile)
  let image = unitValue(unitFile, 'Image') || '-'
  const q = { capture: true }

  const inspect = await ctx.sys.podman(
    engine,
    ['container', 'inspect', name, '--format', '{{.Id}}'],
    q,
  )
  const cid = inspect.status === 0 ? inspect.stdout.trim() : ''
  let st = ''
  if (cid) {
    st = (
      await ctx.sys.podman(
        engine,
        ['ps', '-a', '--filter', `id=${cid}`, '--format', '{{.Status}}'],
        q,
      )
    ).stdout.trim()
    const img = await ctx.sys.podman(
      engine,
      ['ps', '-a', '--filter', `id=${cid}`, '--format', '{{.Image}}'],
      q,
    )
    if (img.status === 0 && img.stdout.trim()) image = img.stdout.trim()
  } else {
    st = (await ctx.sys.systemctl(engine, ['is-active', svc], q)).stdout.replace(/\n/g, '').trim()
    if (st === '' || st === 'inactive') st = 'stopped'
  }
  if (!st) st = 'unknown'
  return [engine, name, st, image]
}

/**
 * Left-aligned table with two-space gutters (column -t).
 * @param {string[][]} rows
 * @returns {string[]}
 */
export function formatTable(rows) {
  const widths = rows.reduce(
    /** @param {number[]} w @param {string[]} r */
    (w, r) => r.map((c, i) => Math.max(w[i] ?? 0, c.length)),
    /** @type {number[]} */ ([]),
  )
  return rows.map((r) =>
    r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] ?? 0))).join('  '),
  )
}

/**
 * Rows for one app's package containers (installed or not-installed placeholders).
 * @param {QuadletContext} ctx
 * @param {string} appArg
 * @param {string[][]} rows
 */
async function appendAppPsRows(ctx, appArg, rows) {
  const app = resolveAppName(appArg)
  const paths = resolveAppEngine(ctx, app)
  const dir = appDir(ctx, app)
  if (!dir) die(`unknown app '${app}' (no applications/${app}/app.yaml)`)
  if (paths.engine === 'rootless') ctx.sys.ensureRootlessBus()
  for (const f of packageUnitFiles(dir, ['container'])) {
    const udir = listUnitDirs(dir).find((d) => f.startsWith(`${d}/`))
    const installed = udir
      ? join(paths.dest, unitInstallName(udir), basename(f))
      : join(paths.dest, basename(f))
    if (existsSync(installed)) {
      rows.push(await psUnitRow(ctx, paths.engine, installed))
    } else {
      // Not installed yet — still show expected name from template.
      rows.push([paths.engine, containerName(f), 'not-installed', unitValue(f, 'Image') || '-'])
    }
  }
}

/**
 * @param {QuadletContext} ctx
 * @param {string | string[]} [appArg] one app, several, or omit for all installed
 */
export async function runPs(ctx, appArg) {
  /** @type {string[][]} */
  const rows = [['ENGINE', 'NAMES', 'STATUS', 'IMAGE']]
  const apps = Array.isArray(appArg)
    ? appArg.map(String).filter(Boolean)
    : typeof appArg === 'string' && appArg
      ? [appArg]
      : []

  if (apps.length === 0) {
    for (const eng of /** @type {const} */ (['rootless', 'rootful'])) {
      const paths = ctx.sys.paths(eng)
      if (eng === 'rootless') ctx.sys.ensureRootlessBus()
      for (const f of installedContainers(paths.dest)) {
        rows.push(await psUnitRow(ctx, eng, f))
      }
    }
  } else {
    for (const app of apps) await appendAppPsRows(ctx, app, rows)
  }
  for (const line of formatTable(rows)) ctx.print(line)
}
