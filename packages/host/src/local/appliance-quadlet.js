/**
 * Guest quadlet ops inside the nested appliance (`qctl quadlet …`).
 */
import { shellQuote } from '../lib/shell-quote.js'
import { execInAppliance } from './exec-in.js'
import { podman, stripPodmanNoise } from './podman.js'
import { die, log, logDim } from './util.js'

/** @import { LocalContext } from './context.js' */

/**
 * Ensure tank dirs exist for common app volume layouts (bind mounts need sources).
 * @param {LocalContext} ctx
 * @param {string} [app]
 * @returns {Promise<void>}
 */
export async function ensureTankDirs(ctx, app) {
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
 * @param {string} table `qctl quadlet ps` stdout
 * @returns {boolean}
 */
export function anyRowUp(table) {
  const rows = String(table)
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
  if (!rows.length) return false
  return rows.some((row) => /\sUp\s/.test(row) || row.includes(' Up '))
}

/**
 * True when every data row contains " Up ".
 * @param {string} table
 * @returns {boolean}
 */
export function allRowsUp(table) {
  const rows = String(table)
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
  return rows.length > 0 && rows.every((row) => row.includes(' Up '))
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
  return anyRowUp(String(r.stdout))
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
    if (allRowsUp(table)) {
      logDim(`${label} healthy`)
      console.log((await quadletPsAll(ctx)).trimEnd() || table.trimEnd())
      return
    }
    if (i > 0 && i % 5 === 0) {
      const status = table
        .split('\n')
        .slice(1)
        .map((row) => row.trim().slice(0, 80))
        .filter(Boolean)
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
