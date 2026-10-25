/**
 * Create sudo/SSH admin from seed Tier-0 ADMIN_* (or key-only default "admin").
 * SSH pubkeys from seed `/etc/rocky/admin_ssh_authorized_keys` (or `seedConfig`).
 * Persists non-secret admin identity into `/etc/qctl/config.json` for day-2 ACL.
 */
import { existsSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { dirname } from 'node:path'

import { QCTL_OS_CONFIG_PATH, osConfigSchema } from '@qctl/shared'

import { StageError } from '../errors.js'
import { writeOsConfig } from '../load-seed-config.js'
import { detectQctlEnv, secretString } from './lib/credentials.js'

/** @import { StageContext } from '../context.js' */

const DEFAULT_USER = 'admin'
const DEFAULT_UID = 1000
const SUDOERS_DROPIN_DEFAULT = '/etc/sudoers.d/90-rocky-wheel'
const ADMIN_KEYS_SRC_DEFAULT = '/etc/rocky/admin_ssh_authorized_keys'

/**
 * @param {string} u
 * @param {string} [appsUsername]
 */
function validUsername(u, appsUsername = 'apps') {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(u)) return false
  if (
    u === 'root'
    || u === 'nobody'
    || u === 'dbus'
    || u === appsUsername
    || u === 'apps'
    || u.startsWith('systemd-')
  ) {
    return false
  }
  return true
}

/**
 * @param {string} raw
 * @param {string} label
 * @param {number} fallback
 */
function parseId(raw, label, fallback) {
  const v = String(raw ?? '').trim()
  if (!v) return fallback
  if (!/^[0-9]+$/.test(v)) {
    throw new Error(`ADMIN_${label} must be an integer (got ${JSON.stringify(v)})`)
  }
  const n = Number(v)
  if (n < 100 || n > 60000) {
    throw new Error(`ADMIN_${label}=${n} out of range (want 100–60000)`)
  }
  if (n === 0 || n === 900) {
    throw new Error(`ADMIN_${label}=${n} reserved (not root/apps)`)
  }
  return n
}

/**
 * @param {StageContext} ctx
 * @param {string} mode
 * @param {string} user
 * @param {string} dropin
 */
async function ensureSudoers(ctx, mode, user, dropin) {
  const body =
    mode === 'keyonly'
      ? `# Rocky appliance (no ADMIN_USERNAME/PASSWORD): key-only admin, passwordless sudo.\n${user} ALL=(ALL) NOPASSWD: ALL\n`
      : `# Rocky appliance: wheel members may sudo with their password (Cockpit / CLI).\n%wheel ALL=(ALL) ALL\n`
  await fsp.writeFile(dropin, body, { mode: 0o440 })
  await fsp.chmod(dropin, 0o440)
  const v = await ctx.exec(['visudo', '-cf', dropin])
  if (v.code !== 0) throw new Error(`invalid ${dropin}`)
}

/**
 * @param {StageContext} ctx
 * @param {{ mode: string, user: string, pass: string, uid: number, gid: number }} admin
 * @param {string} keysSrc
 */
async function ensureAdminUser(ctx, admin, keysSrc) {
  const { mode, user, pass, uid, gid } = admin
  const script = `
set -euo pipefail
u="$1"; uid="$2"; gid="$3"; mode="$4"; pass="$5"; keys_src="$6"

ensure_primary_group() {
  if getent group "$gid" >/dev/null; then
    existing="$(getent group "$gid" | cut -d: -f1)"
    [[ "$existing" == "$u" ]] || { echo "GID $gid used by '$existing'" >&2; exit 1; }
    return
  fi
  if getent group "$u" >/dev/null; then
    egid="$(getent group "$u" | cut -d: -f3)"
    [[ "$egid" == "$gid" ]] || { echo "group '$u' GID $egid want $gid" >&2; exit 1; }
    return
  fi
  groupadd -g "$gid" "$u"
}

ensure_primary_group

if id "$u" &>/dev/null; then
  cur_uid="$(id -u "$u")"; cur_gid="$(id -g "$u")"
  [[ "$cur_uid" == "$uid" && "$cur_gid" == "$gid" ]] \
    || { echo "user '$u' is \${cur_uid}:\${cur_gid} want \${uid}:\${gid}" >&2; exit 1; }
else
  getent passwd "$uid" >/dev/null && { echo "UID $uid already used" >&2; exit 1; }
  useradd -m -u "$uid" -g "$gid" -G wheel -s /bin/bash "$u"
fi
usermod -aG wheel "$u"

if [[ "$mode" == keyonly ]]; then
  passwd -l "$u" >/dev/null
else
  printf '%s:%s\\n' "$u" "$pass" | chpasswd
  passwd -u "$u" 2>/dev/null || true
fi

home="$(getent passwd "$u" | cut -d: -f6)"
[[ -n "$home" && -d "$home" ]] || { echo "no home for $u" >&2; exit 1; }
[[ -f "$keys_src" ]] || { echo "missing $keys_src" >&2; exit 1; }
grep -Eqv '^[[:space:]]*(#|$)' "$keys_src" || { echo "$keys_src has no keys" >&2; exit 1; }
mkdir -p "$home/.ssh"
chmod 0700 "$home/.ssh"
chown "$u:$gid" "$home/.ssh"
install -m 0600 -o "$u" -g "$gid" "$keys_src" "$home/.ssh/authorized_keys"
command -v restorecon >/dev/null 2>&1 && restorecon -Rv "$home/.ssh" >/dev/null || true

for f in /etc/subuid /etc/subgid; do
  [[ -f "$f" ]] || continue
  grep -q "^\${u}:" "$f" && sed -i "/^\${u}:/d" "$f"
done

# /vw CLI apodata → admin-owned when present
if [[ -d /vw ]]; then
  chown -R "$u:$gid" /vw 2>/dev/null || true
fi

mkdir -p /etc/rocky
printf '%s\\n' "$u" >/etc/rocky/admin-user
chmod 0644 /etc/rocky/admin-user
`
  const r = await ctx.exec([
    'bash',
    '-c',
    script,
    'admin-user-ensure',
    user,
    String(uid),
    String(gid),
    mode,
    pass,
    keysSrc,
  ])
  if (r.code !== 0) {
    throw new Error(r.stderr || r.stdout || `exit ${r.code}`)
  }
}

export default {
  name: 'admin-user',
  describe: 'Create sudo/SSH admin from seed ADMIN_* (or key-only default)',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    return [
      `Tier-0 ADMIN_* (QCTL_ENV=${detectQctlEnv(ctx.osConfig)})`,
      'ADMIN_USERNAME+PASSWORD → password sudo; else key-only admin + NOPASSWD',
      'install seed admin_ssh_authorized_keys; write /etc/rocky/admin-user',
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('admin-user', 'must run as root')

    const username = secretString(ctx.secrets, 'ADMIN_USERNAME')
    const password = secretString(ctx.secrets, 'ADMIN_PASSWORD')
    const defaultUser = DEFAULT_USER
    const appsUsername = ctx.osConfig.quadletUser?.trim() || 'apps'
    const keysSrc = ctx.paths.adminKeys?.trim() || ADMIN_KEYS_SRC_DEFAULT
    const sudoers = ctx.paths.sudoersDropin?.trim() || SUDOERS_DROPIN_DEFAULT

    /** @type {{ mode: string, user: string, pass: string, uid: number, gid: number }} */
    let admin
    try {
      const uid = parseId(secretString(ctx.secrets, 'ADMIN_UID'), 'UID', DEFAULT_UID)
      const gid = parseId(secretString(ctx.secrets, 'ADMIN_GID'), 'GID', uid)
      if (!password) {
        const user = username || defaultUser
        ctx.log(`rocky-admin-user: no ADMIN_PASSWORD — key-only '${user}'`)
        admin = { mode: 'keyonly', user, pass: '', uid, gid }
      } else {
        if (!username) {
          throw new Error('ADMIN_PASSWORD set but ADMIN_USERNAME missing')
        }
        if (!validUsername(username, appsUsername)) {
          throw new Error(`refusing username ${JSON.stringify(username)}`)
        }
        admin = { mode: 'password', user: username, pass: password, uid, gid }
        ctx.log(
          `rocky-admin-user: provision → user '${admin.user}' uid=${admin.uid} gid=${admin.gid} (password sudo)`,
        )
      }
      if (!validUsername(admin.user, appsUsername)) {
        throw new Error(`invalid admin username ${JSON.stringify(admin.user)}`)
      }
      await ensureSudoers(ctx, admin.mode, admin.user, sudoers)
      await ensureAdminKeysFile(ctx, keysSrc)
      await ensureAdminUser(ctx, admin, keysSrc)
      persistAdminOsConfig(ctx, { username: admin.user, uid: admin.uid, gid: admin.gid })
      await refreshSupervisorAdminAcl(ctx)
    } catch (err) {
      throw new StageError('admin-user', err instanceof Error ? err.message : String(err))
    }
    ctx.log(`rocky-admin-user: user '${admin.user}' ready`)
  },
}

/**
 * Re-read OsConfig (admin uid/gid) and re-chown sockets after Tier-0 admin is known.
 * @param {StageContext} ctx
 */
async function refreshSupervisorAdminAcl(ctx) {
  const r = await ctx.exec(['systemctl', 'try-restart', 'qctl-supervisor.service'])
  if (r.code !== 0) {
    ctx.log(
      `rocky-admin-user: WARN try-restart qctl-supervisor failed: ${r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`}`,
    )
    return
  }
  ctx.log('rocky-admin-user: restarted qctl-supervisor (admin socket ACL)')
}

/**
 * Write resolved admin identity into OS config (seed may already have it; Tier-0 wins).
 * @param {StageContext} ctx
 * @param {{ username: string, uid: number, gid: number }} admin
 */
function persistAdminOsConfig(ctx, admin) {
  const next = osConfigSchema.parse({ ...ctx.osConfig, admin })
  ctx.osConfig.admin = next.admin
  const path = process.env.QCTL_OS_CONFIG?.trim() || QCTL_OS_CONFIG_PATH
  writeOsConfig(next, path)
  ctx.log(
    `rocky-admin-user: wrote admin ${admin.username} uid=${admin.uid} gid=${admin.gid} → ${path}`,
  )
}

/**
 * Prefer on-disk keys (load-seed / cloud-init); else write from `seedConfig`.
 * @param {StageContext} ctx
 * @param {string} keysSrc
 */
async function ensureAdminKeysFile(ctx, keysSrc) {
  if (existsSync(keysSrc)) return
  const body = ctx.seedConfig?.adminSshAuthorizedKeys
  if (body == null || body === '') {
    throw new Error(
      `missing admin SSH keys at ${keysSrc} (and no seedConfig.adminSshAuthorizedKeys)`,
    )
  }
  await fsp.mkdir(dirname(keysSrc), { recursive: true })
  const text = body.endsWith('\n') ? body : `${body}\n`
  await fsp.writeFile(keysSrc, text, { mode: 0o644 })
  ctx.log(`rocky-admin-user: wrote ${keysSrc} from seed config`)
}
