import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { SEED_PROFILE, osConfigSchema } from '@qctl/shared'

import { getRockySeedRoot } from '../seed-root.js'
import { execInAppliance } from './exec-in.js'
import { die, log, logDim } from './util.js'

/** @import { LocalContext } from './context.js' */

/**
 * Unit bodies from the Rocky seed kit (`first-boot/`), same as VM cloud-init / guest baseline.
 * @returns {{ supervisor: string, appProxy: string }}
 */
export function qctlUnitTextsFromSeed() {
  const root = getRockySeedRoot()
  const supervisorPath = join(root, 'first-boot', 'qctl-supervisor.service')
  const appProxyPath = join(root, 'first-boot', 'qctl-app@.service')
  try {
    return {
      supervisor: readFileSync(supervisorPath, 'utf8'),
      appProxy: readFileSync(appProxyPath, 'utf8'),
    }
  } catch (err) {
    die(
      `missing seed unit files under ${join(root, 'first-boot')}\n`
        + `  ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Install `qctl-supervisor.service` + `qctl-app@.service` (system + user) and enable supervisor.
 * Mirrors guest `host-baseline` ensureQctlSupervisorBaseline for the nested local appliance.
 * @param {LocalContext} ctx
 * @returns {Promise<void>}
 */
export async function ensureQctlSystemdUnits(ctx) {
  const { supervisor, appProxy } = qctlUnitTextsFromSeed()
  const user = ctx.appsUsername
  log('install qctl-supervisor + qctl-app@; enable supervisor')

  // Concatenate unit bodies so seed content cannot interpolate into this template.
  const script = [
    'set -euo pipefail',
    `APPS_USER=${JSON.stringify(user)}`,
    'uid=$(id -u "$APPS_USER")',
    'rt=/run/user/$uid',
    'bus=$rt/bus',
    "cat > /etc/systemd/system/qctl-supervisor.service <<'QCTL_UNIT_EOF'",
    supervisor.replace(/\n$/, ''),
    'QCTL_UNIT_EOF',
    'mkdir -p /etc/systemd/user',
    "cat > /etc/systemd/system/qctl-app@.service <<'QCTL_UNIT_EOF'",
    appProxy.replace(/\n$/, ''),
    'QCTL_UNIT_EOF',
    'cp -f /etc/systemd/system/qctl-app@.service /etc/systemd/user/qctl-app@.service',
    'chmod 0644 /etc/systemd/system/qctl-supervisor.service \\',
    '  /etc/systemd/system/qctl-app@.service \\',
    '  /etc/systemd/user/qctl-app@.service',
    'systemctl daemon-reload',
    'systemctl start "user@${uid}.service"',
    'for i in $(seq 1 50); do',
    '  [ -S "$bus" ] && break',
    '  sleep 0.2',
    'done',
    'runuser -u "$APPS_USER" -- env XDG_RUNTIME_DIR="$rt" DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" \\',
    '  systemctl --user daemon-reload',
    'systemctl enable --now qctl-supervisor.service',
    'systemctl is-active --quiet qctl-supervisor.service',
  ].join('\n')

  await execInAppliance(ctx, script)
  logDim('qctl-supervisor active; qctl-app@ installed (system + user)')
}

/**
 * mkdir + chown provision disk mount roots inside the appliance (not `repoDir` —
 * that bind is the instance tree on the host).
 * @param {LocalContext} ctx
 * @returns {Promise<void>}
 */
export async function ensureLocalDiskMountOwnership(ctx) {
  const user = ctx.appsUsername
  const mounts = [...new Set((ctx.diskMounts ?? []).map((m) => m.mount))]
  if (!mounts.length) return

  const script = [
    'set -euo pipefail',
    `APPS_USER=${JSON.stringify(user)}`,
    ...mounts.flatMap((mount) => [
      `mkdir -p ${JSON.stringify(mount)}`,
      `chown -R "$APPS_USER:$APPS_USER" ${JSON.stringify(mount)}`,
    ]),
  ].join('\n')

  await execInAppliance(ctx, script)
}

/**
 * Shell fragment: ensure each type:dummy iface exists and is up.
 * @param {string[]} names
 * @returns {string}
 */
export function dummyIfacesShell(names) {
  if (names.length === 0) return '# no type:dummy interfaces in provision'
  return names
    .map((name) => {
      const q = JSON.stringify(name)
      return [
        `if ! ip link show ${q} >/dev/null 2>&1; then`,
        `  ip link add ${q} type dummy`,
        'fi',
        `ip link set ${q} up`,
      ].join('\n')
    })
    .join('\n')
}

/**
 * Bootstrap apps user, nested podman, provision `type:dummy` ifaces,
 * and `/etc/qctl/config.json` (same day-2 identity contract as VM guest load-seed).
 * `/etc/subuid`+`/etc/subgid` match provision `users.apps` exactly.
 * @param {LocalContext} ctx
 * @returns {Promise<void>}
 */
export async function provisionAppliance(ctx) {
  log('provision apps user + linger + OS config')
  const user = ctx.appsUsername
  const uid = ctx.appsUid
  const gid = ctx.appsGid
  const home = `/home/${user}`
  const subUidLast = ctx.appsSubuid.start + ctx.appsSubuid.count - 1
  const subGidLast = ctx.appsSubgid.start + ctx.appsSubgid.count - 1
  const repoDir = ctx.repoDir

  const os = osConfigSchema.parse({
    env: ctx.env,
    root: repoDir,
    repo: ctx.repo,
    quadletUser: user,
    apps: {
      username: user,
      uid,
      gid,
      subuid: ctx.appsSubuid,
      subgid: ctx.appsSubgid,
    },
    admin: {
      username: ctx.adminUsername,
      uid: ctx.adminUid,
      gid: ctx.adminGid,
    },
    timezone: 'Europe/Paris',
    profile: SEED_PROFILE.APPLIANCE,
  })
  const osJson = JSON.stringify(os, null, 2)
  const dummies = dummyIfacesShell(ctx.dummyIfaces ?? [])
  const mountChown = (ctx.diskMounts ?? [])
    .map((m) => m.mount)
    .filter((m, i, arr) => arr.indexOf(m) === i)
    .map(
      (mount) =>
        `mkdir -p ${JSON.stringify(mount)}\nchown -R "$APPS_USER:$APPS_USER" ${JSON.stringify(mount)}`,
    )
    .join('\n')

  const script = `
set -euo pipefail
command -v jq >/dev/null || dnf -yq install jq >/dev/null
command -v ip >/dev/null || dnf -yq install iproute >/dev/null
mount --make-rshared / 2>/dev/null || true
mkdir -p /etc/containers/containers.conf.d
printf '%s\\n' \\
  '[containers]' 'utsns = "private"' 'pids_limit = 0' \\
  '[engine]' 'log_level = "fatal"' \\
  > /etc/containers/containers.conf.d/90-ci-uts.conf
# Sparse outer map — image layers with unmapped UIDs need this.
mkdir -p /etc/containers/storage.conf.d
printf '%s\\n' '[storage.options]' 'ignore_chown_errors = "true"' \\
  > /etc/containers/storage.conf.d/90-local-ignore-chown.conf
APPS_USER=${JSON.stringify(user)}
groupadd -g ${gid} "$APPS_USER" 2>/dev/null || true
id "$APPS_USER" >/dev/null 2>&1 || useradd -u ${uid} -g "$APPS_USER" -m -d ${JSON.stringify(home)} -s /bin/bash "$APPS_USER"
sed -i "/^\${APPS_USER}:/d" /etc/subuid /etc/subgid 2>/dev/null || true
usermod --add-subuids "${ctx.appsSubuid.start}-${subUidLast}" "$APPS_USER"
usermod --add-subgids "${ctx.appsSubgid.start}-${subGidLast}" "$APPS_USER"
mkdir -p /usr/local/lib/rocky /etc/qctl
cat > /etc/qctl/config.json <<'EOF'
${osJson}
EOF
chmod 0644 /etc/qctl/config.json
mkdir -p "${home}/.config/containers/containers.conf.d"
cp /etc/containers/containers.conf.d/90-ci-uts.conf \\
  "${home}/.config/containers/containers.conf.d/90-ci-uts.conf"
chown -R "$APPS_USER:$APPS_USER" "${home}/.config"
loginctl enable-linger "$APPS_USER"
systemctl start "user@$(id -u "$APPS_USER").service"
systemctl enable --now podman.socket
runuser -u "$APPS_USER" -- bash -lc 'export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user enable --now podman.socket; podman system migrate >/dev/null 2>&1 || true'
${mountChown}
${dummies}
`
  await execInAppliance(ctx, script)
  logDim('provision complete')
}
