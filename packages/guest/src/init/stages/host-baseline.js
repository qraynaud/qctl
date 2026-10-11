/**
 * Host baseline: timezone, linger, apps subids/podman socket, ZFS module,
 * offline firewall, then /vw mount.
 */
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'

import { StageError } from '../errors.js'
import vwMount from './vw-mount.js'

/** @import { StageContext } from '../context.js' */

/**
 * @param {StageContext} ctx
 * @param {string} argv0
 * @param {string[]} rest
 */
async function must(ctx, argv0, ...rest) {
  const r = await ctx.exec([argv0, ...rest])
  if (r.code !== 0) {
    throw new Error(`${argv0} ${rest.join(' ')} failed: ${r.stderr.trim() || r.stdout.trim()}`)
  }
  return r
}

/**
 * @param {string} file
 * @param {RegExp} re
 * @param {string} line
 */
async function ensureLoginDefsLine(file, re, line) {
  let body = ''
  try {
    body = await readFile(file, 'utf8')
  } catch {
    throw new Error(`missing ${file}`)
  }
  if (re.test(body)) {
    body = body.replace(re, line)
  } else {
    body = `${body.replace(/\s*$/, '')}\n${line}\n`
  }
  await writeFile(file, body)
}

/**
 * @param {string} file
 * @returns {number}
 */
function nextSubidStart(file) {
  let max = 100000
  if (!existsSync(file)) return max
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const parts = line.split(':')
    if (parts.length < 3) continue
    const start = Number(parts[1])
    const count = Number(parts[2])
    if (!Number.isFinite(start) || !Number.isFinite(count)) continue
    const end = start + count
    if (end > max) max = end
  }
  return max
}

/**
 * @param {StageContext} ctx
 */
async function ensureAppsHome(ctx) {
  const id = await ctx.exec(['id', 'apps'])
  if (id.code !== 0) throw new Error('user apps missing (cloud-init should create UID/GID 900)')
  const homeR = await ctx.exec(['getent', 'passwd', 'apps'])
  let home = homeR.stdout.split(':')[5] || ''
  if (!home || home === '/' || home === '/nonexistent') home = '/home/apps'
  if (!existsSync(home)) {
    ctx.log(`rocky-baseline: creating apps home ${home} (Podman rootless)`)
    await mkdir(home, { recursive: true })
    await must(ctx, 'chown', 'apps:apps', home)
    await must(ctx, 'chmod', '0750', home)
  }
  const cur = (await ctx.exec(['getent', 'passwd', 'apps'])).stdout.split(':')[5] || ''
  if (cur !== home) {
    ctx.log(`rocky-baseline: usermod -d ${home} apps (was ${cur})`)
    await must(ctx, 'usermod', '-d', home, 'apps')
  }
  await ctx.exec(['restorecon', '-RF', home])
}

/**
 * @param {StageContext} ctx
 */
async function ensureAppsJournalGroup(ctx) {
  const g = await ctx.exec(['getent', 'group', 'systemd-journal'])
  if (g.code !== 0) throw new Error('group systemd-journal missing')
  const groups = await ctx.exec(['id', '-nG', 'apps'])
  if (groups.stdout.trim().split(/\s+/).includes('systemd-journal')) return
  ctx.log('rocky-baseline: usermod -aG systemd-journal apps')
  await must(ctx, 'usermod', '-aG', 'systemd-journal', 'apps')
}

/**
 * @param {StageContext} ctx
 */
async function ensureAppsSubids(ctx) {
  const count = Number(ctx.env.ROCKY_APPS_SUBID_COUNT || 65536) || 65536
  const subuid = await Bun.file('/etc/subuid')
    .text()
    .catch(() => '')
  if (!/^apps:/m.test(subuid)) {
    const start = Number(ctx.env.ROCKY_APPS_SUBID_START) || nextSubidStart('/etc/subuid')
    const end = start + count - 1
    ctx.log(`rocky-baseline: usermod --add-subuids ${start}-${end} apps`)
    await must(ctx, 'usermod', '--add-subuids', `${start}-${end}`, 'apps')
  }
  const subgid = await Bun.file('/etc/subgid')
    .text()
    .catch(() => '')
  if (!/^apps:/m.test(subgid)) {
    const start =
      Number(ctx.env.ROCKY_APPS_SUBGID_START)
      || Number(ctx.env.ROCKY_APPS_SUBID_START)
      || nextSubidStart('/etc/subgid')
    const end = start + count - 1
    ctx.log(`rocky-baseline: usermod --add-subgids ${start}-${end} apps`)
    await must(ctx, 'usermod', '--add-subgids', `${start}-${end}`, 'apps')
  }
  await ctx.exec(['runuser', '-u', 'apps', '--', 'podman', 'system', 'migrate'])
  const home = (await ctx.exec(['getent', 'passwd', 'apps'])).stdout.split(':')[5] || ''
  const containers = `${home}/.local/share/containers`
  if (existsSync(containers)) {
    await ctx.exec(['restorecon', '-RF', containers])
  }
}

/**
 * @param {StageContext} ctx
 */
async function ensureAppsPodmanApiSocket(ctx) {
  const uidR = await ctx.exec(['id', '-u', 'apps'])
  if (uidR.code !== 0) throw new Error('user apps missing')
  const uid = uidR.stdout.trim()
  const rt = `/run/user/${uid}`
  const bus = `${rt}/bus`
  await ctx.exec(['systemctl', 'start', `user@${uid}.service`])
  if (!existsSync(bus)) {
    throw new Error(`no user bus at ${bus} after user@${uid}.service (linger apps?)`)
  }
  const r = await ctx.exec([
    'runuser',
    '-u',
    'apps',
    '--',
    'env',
    `XDG_RUNTIME_DIR=${rt}`,
    `DBUS_SESSION_BUS_ADDRESS=unix:path=${bus}`,
    'systemctl',
    '--user',
    'enable',
    '--now',
    'podman.socket',
  ])
  if (r.code !== 0) {
    throw new Error(`enable podman.socket failed: ${r.stderr.trim()}`)
  }
  const sock = `${rt}/podman/podman.sock`
  if (!existsSync(sock)) {
    throw new Error(`podman.socket enabled but ${sock} missing`)
  }
  ctx.log(`rocky-baseline: apps podman.socket enabled → ${sock}`)
}

export default {
  name: 'host-baseline',
  describe: 'Timezone, linger, apps subids/podman socket, ZFS module, offline firewall, /vw mount',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    const tz = ctx.env.ROCKY_TIMEZONE?.trim() || 'Europe/Paris'
    return [
      `timedatectl set-timezone ${tz}`,
      'login.defs SUB_*_COUNT=0 + umask 022',
      'linger apps + subids + podman.socket',
      'modprobe zfs; firewall-offline-cmd ssh/cockpit/http/https',
      ...vwMount.plan(ctx),
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('host-baseline', 'must run as root')
    const tz = ctx.env.ROCKY_TIMEZONE?.trim() || 'Europe/Paris'

    try {
      ctx.log('rocky-baseline: start')
      await must(ctx, 'timedatectl', 'set-timezone', tz)

      await ensureLoginDefsLine('/etc/login.defs', /^SUB_UID_COUNT\s+.*/m, 'SUB_UID_COUNT 0')
      await ensureLoginDefsLine('/etc/login.defs', /^SUB_GID_COUNT\s+.*/m, 'SUB_GID_COUNT 0')
      ctx.log(
        'rocky-baseline: login.defs: SUB_UID_COUNT/SUB_GID_COUNT=0 (no auto subids on useradd)',
      )

      await ensureLoginDefsLine('/etc/login.defs', /^UMASK\s+.*/m, 'UMASK\t\t022')
      const drop = '/etc/profile.d/rocky-umask.sh'
      await writeFile(
        drop,
        `# Rocky: keep world-readable defaults so apps can ExecStartPre scripts under /tank/rocky.
# (hg applies the process umask when updating the working tree.)
umask 022
`,
      )
      await chmod(drop, 0o644)
      ctx.log(`rocky-baseline: umask 022 (/etc/login.defs UMASK + ${drop})`)

      await ensureAppsHome(ctx)
      await ensureAppsJournalGroup(ctx)
      await ensureAppsSubids(ctx)
      await must(ctx, 'loginctl', 'enable-linger', 'apps')
      await ensureAppsPodmanApiSocket(ctx)

      await mkdir('/etc/modules-load.d', { recursive: true })
      await writeFile('/etc/modules-load.d/zfs.conf', 'zfs\n')
      await must(ctx, 'modprobe', 'zfs')

      for (const svc of ['ssh', 'cockpit', 'http', 'https']) {
        await must(ctx, 'firewall-offline-cmd', `--add-service=${svc}`)
      }

      ctx.log('rocky-baseline: done')
    } catch (err) {
      throw new StageError('host-baseline', err instanceof Error ? err.message : String(err))
    }

    await vwMount.run(ctx)
  },
}
