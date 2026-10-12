import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { execInAppliance } from './exec-in.js'
import { podman, stripPodmanNoise } from './podman.js'
import { provisionAppliance } from './provision.js'
import { die, log, logDim } from './util.js'

/**
 * Host registries auth for nested rootful pulls (e.g. docker.io after `podman login`).
 * @returns {string | null}
 */
function hostContainersAuthFile() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  /** @type {string[]} */
  const candidates = []
  if (uid != null) candidates.push(join('/run/user', String(uid), 'containers/auth.json'))
  candidates.push(join(homedir(), '.config/containers/auth.json'))
  return candidates.find((p) => existsSync(p)) || null
}

/** @import { LocalContext } from './context.js' */

/**
 * @param {LocalContext} ctx
 * @returns {Promise<boolean>}
 */
export async function applianceExists(ctx) {
  const r = await podman(['container', 'exists', ctx.name], { nothrow: true })
  return r.exitCode === 0
}

/**
 * @param {LocalContext} ctx
 * @returns {Promise<boolean>}
 */
export async function applianceRunning(ctx) {
  if (!(await applianceExists(ctx))) return false
  const r = await podman(['inspect', '-f', '{{.State.Running}}', ctx.name], { nothrow: true })
  return String(r.stdout).trim() === 'true'
}

/**
 * @param {LocalContext} ctx
 * @returns {Promise<void>}
 */
export async function removeAppliance(ctx) {
  log(`remove ${ctx.name}`)
  await podman(['rm', '-f', ctx.name], { nothrow: true })
}

/**
 * Wait until systemd is running|degraded inside the appliance.
 * @param {LocalContext} ctx
 * @param {number} [seconds]
 * @returns {Promise<void>}
 */
export async function waitSystemd(ctx, seconds = 90) {
  logDim('waiting for systemd…')
  for (let i = 0; i < seconds; i++) {
    if (!(await applianceRunning(ctx))) {
      die('appliance container exited while waiting for systemd')
    }
    const r = await podman(['exec', ctx.name, 'systemctl', 'is-system-running'], { nothrow: true })
    const state = String(r.stdout).trim()
    if (state === 'running' || state === 'degraded') {
      logDim(`systemd ${state}`)
      return
    }
    if (i > 0 && i % 10 === 0) logDim(`still waiting for systemd (${state || '…'}, ${i}s)`)
    await Bun.sleep(1000)
  }
  const logs = await podman(['logs', '--tail', '80', ctx.name], { nothrow: true })
  console.error(stripPodmanNoise(String(logs.stdout || logs.stderr)))
  die('systemd appliance not ready')
}

/**
 * Start (or reuse) the nested appliance and provision once when newly created.
 * @param {LocalContext} ctx
 * @returns {Promise<void>}
 */
export async function ensureAppliance(ctx) {
  if (await applianceRunning(ctx)) {
    logDim(`appliance already running (${ctx.name})`)
    return
  }

  if (await applianceExists(ctx)) {
    log(`start existing ${ctx.name}`)
    const r = await podman(['start', ctx.name], { nothrow: true })
    if (r.exitCode !== 0) {
      die(String(r.stderr || r.stdout).trim() || 'podman start failed')
    }
    await waitSystemd(ctx)
    return
  }

  mkdirSync(join(ctx.root, 'volumes'), { recursive: true })

  log(`boot systemd appliance (${ctx.image})`)
  const runArgs = [
    'run',
    '-d',
    '--name',
    ctx.name,
    '--privileged',
    '--systemd=always',
    '--cgroupns=host',
    ...ctx.uidMapArgs,
    ...ctx.publishArgs,
    '-v',
    `${ctx.root}:/tank/rocky:Z`,
    '-v',
    `${ctx.guestBin}:/usr/local/bin/qctl:ro`,
    '-v',
    `${ctx.platformModulePath}:/usr/local/lib/qctl/${ctx.platformBasename}:ro`,
    '-e',
    'container=podman',
    '-e',
    'QCTL_ROOT=/tank/rocky',
    '-e',
    `QCTL_ENV=${ctx.env}`,
    '-e',
    `QCTL_PLATFORM_MODULE=/usr/local/lib/qctl/${ctx.platformBasename}`,
    '-e',
    'QCTL_LIB_DIR=/usr/local/lib/qctl',
    '-e',
    'TANK_ROOT=/tank/rocky/volumes',
    '-e',
    'CONTAINERS_LOG_LEVEL=fatal',
    ctx.image,
    '/sbin/init',
  ]

  const authFile = hostContainersAuthFile()
  if (authFile) {
    // Nested rootful podman + REGISTRY_AUTH_FILE so docker.io login on the host applies.
    runArgs.splice(
      runArgs.length - 2,
      0,
      '-v',
      `${authFile}:/run/containers/auth.json:ro`,
      '-v',
      `${authFile}:/root/.config/containers/auth.json:ro`,
      '-e',
      'REGISTRY_AUTH_FILE=/run/containers/auth.json',
    )
  }

  const extra = process.env.QCTL_LOCAL_PODMAN_RUN_ARGS?.trim()
  if (extra) {
    // Same escape hatch as rocky CI (e.g. rare pasta workarounds).
    runArgs.splice(runArgs.length - 2, 0, ...extra.split(/\s+/).filter(Boolean))
  }

  const r = await podman(runArgs, { nothrow: true })
  if (r.exitCode !== 0) {
    die(String(r.stderr || r.stdout).trim() || 'podman run failed')
  }

  await waitSystemd(ctx)
  await provisionAppliance(ctx)
}

/**
 * Ensure tank dirs exist for common app volume layouts (bind mounts need sources).
 * @param {LocalContext} ctx
 * @param {string} [app]
 * @returns {Promise<void>}
 */
async function ensureTankDirs(ctx, app) {
  const appPart = app
    ? `
mkdir -p /tank/rocky/volumes/${shellQuote(app)}/config \\
         /tank/rocky/volumes/${shellQuote(app)}/data \\
         /tank/rocky/volumes/${shellQuote(app)}
`
    : ''
  await execInAppliance(
    ctx,
    `mkdir -p /tank/rocky/volumes
${appPart}
chown -R apps:apps /tank/rocky/volumes
`,
  )
}

/**
 * @param {LocalContext} ctx
 * @param {string | string[]} apps
 * @returns {Promise<void>}
 */
export async function quadletUp(ctx, apps) {
  const list = (Array.isArray(apps) ? apps : [apps]).map(String).filter(Boolean)
  if (!list.length) return
  log(`quadlet up ${list.join(' ')}`)
  for (const app of list) await ensureTankDirs(ctx, app)
  await execInAppliance(ctx, `cd /tank/rocky && qctl quadlet up ${list.map(shellQuote).join(' ')}`)
}

/**
 * @param {LocalContext} ctx
 * @returns {Promise<void>}
 */
export async function quadletUpAll(ctx) {
  log('quadlet up (all apps)')
  await ensureTankDirs(ctx)
  await execInAppliance(ctx, 'cd /tank/rocky && qctl quadlet up')
}

/**
 * @param {LocalContext} ctx
 * @param {string | string[]} apps
 * @returns {Promise<void>}
 */
export async function quadletDown(ctx, apps) {
  const list = (Array.isArray(apps) ? apps : [apps]).map(String).filter(Boolean)
  if (!list.length) return
  log(`quadlet down ${list.join(' ')}`)
  await execInAppliance(
    ctx,
    `cd /tank/rocky && qctl quadlet down ${list.map(shellQuote).join(' ')} || true`,
    { nothrow: true },
  )
}

/**
 * True when any installed container row reports " Up ".
 * @param {LocalContext} ctx
 * @returns {Promise<boolean>}
 */
export async function anyQuadletUp(ctx) {
  const r = await execInAppliance(ctx, 'cd /tank/rocky && qctl quadlet ps', {
    nothrow: true,
  })
  const table = String(r.stdout)
  const rows = table
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
  if (!rows.length) return false
  return rows.some((row) => /\sUp\s/.test(row) || row.includes(' Up '))
}

/**
 * Full `qctl quadlet ps` table from the appliance (both engines).
 * @param {LocalContext} ctx
 * @returns {Promise<string>}
 */
async function quadletPsAll(ctx) {
  const r = await execInAppliance(ctx, 'cd /tank/rocky && qctl quadlet ps', { nothrow: true })
  return String(r.stdout)
}

/**
 * Wait until every row of `qctl quadlet ps <apps…>` contains " Up ".
 * On success (or timeout) prints the full unfiltered `quadlet ps` table.
 * @param {LocalContext} ctx
 * @param {string | string[]} apps
 * @param {number} [attempts]
 * @returns {Promise<void>}
 */
export async function waitQuadletHealthy(ctx, apps, attempts = 90) {
  const list = (Array.isArray(apps) ? apps : [apps]).map(String).filter(Boolean)
  if (!list.length) return
  const label = list.join(' ')
  log(`wait for ${label} healthy`)
  let table = ''
  for (let i = 0; i < attempts; i++) {
    const r = await execInAppliance(
      ctx,
      `cd /tank/rocky && qctl quadlet ps ${list.map(shellQuote).join(' ')}`,
      { nothrow: true },
    )
    table = String(r.stdout)
    const rows = table
      .split('\n')
      .slice(1)
      .filter((l) => l.trim())
    if (rows.length && rows.every((row) => row.includes(' Up '))) {
      logDim(`${label} healthy`)
      console.log((await quadletPsAll(ctx)).trimEnd() || table.trimEnd())
      return
    }
    if (i > 0 && i % 5 === 0) {
      const status = rows.map((row) => row.trim().slice(0, 80)).filter(Boolean)
      logDim(
        `still waiting for ${label} (${i * 2}s)${status.length ? `\n${status.join('\n')}` : ''}`,
      )
    }
    await Bun.sleep(2000)
  }
  console.error((await quadletPsAll(ctx)).trimEnd() || table.trimEnd() || '(no quadlet ps output)')
  die(`not all containers for ${label} are Up`)
}

/**
 * Print journals / podman state for debugging a failed local run.
 * @param {LocalContext} ctx
 * @param {string} [app]
 * @returns {Promise<void>}
 */
export async function dumpFailureLogs(ctx, app) {
  const user = ctx.appsUsername || 'apps'
  const userQ = shellQuote(user)
  const appQ = app ? shellQuote(app) : ''
  console.error(`--- local failure logs (${ctx.name}${app ? ` / ${app}` : ''}) ---`)

  const hostLogs = await podman(['logs', '--tail', '60', ctx.name], { nothrow: true })
  const hostOut = stripPodmanNoise(String(hostLogs.stdout || hostLogs.stderr)).trim()
  if (hostOut) {
    console.error('--- appliance (host podman logs) ---')
    console.error(hostOut)
  }

  const appBlock = app
    ? `
echo '--- systemctl status ---'
systemctl status ${appQ}.service --no-pager -l 2>/dev/null || true
echo '--- journalctl unit ---'
journalctl -u ${appQ}.service -n 120 --no-pager 2>/dev/null || true
echo '--- podman logs (root) ---'
podman logs --tail 100 ${appQ} 2>/dev/null || true
echo '--- podman logs (apps) ---'
runuser -u ${userQ} -- env XDG_RUNTIME_DIR=/run/user/$uid \\
  podman logs --tail 100 ${appQ} 2>/dev/null || true
`
    : ''
  const r = await execInAppliance(
    ctx,
    `
set +e
uid=$(id -u ${userQ} 2>/dev/null || echo "")
${appBlock}
echo '--- journalctl recent ---'
journalctl -n 50 --no-pager 2>/dev/null || true
if [ -n "$uid" ]; then
  echo '--- journalctl apps uid ---'
  journalctl _UID="$uid" -n 80 --no-pager 2>/dev/null || true
fi
echo '--- podman ps (root) ---'
podman ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}' 2>/dev/null || true
echo '--- podman ps (apps) ---'
runuser -u ${userQ} -- env XDG_RUNTIME_DIR=/run/user/$uid \\
  podman ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}' 2>/dev/null || true
echo '--- /etc/subuid /etc/subgid ---'
cat /etc/subuid /etc/subgid 2>/dev/null || true
`,
    { nothrow: true },
  )
  const out = stripPodmanNoise(`${r.stdout}${r.stderr}`).trim()
  if (out) console.error(out)
  console.error('--- end failure logs ---')
}

/**
 * @param {string} s
 * @returns {string}
 */
function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
