import { SEED_PROFILE, osConfigSchema } from '@qctl/shared'

import { execInAppliance } from './exec-in.js'
import { log, logDim } from './util.js'

/** @import { LocalContext } from './context.js' */

/**
 * Bootstrap apps user, nested podman, volumes, dummy vlan2, and `/etc/qctl/config.json`
 * (same day-2 identity contract as VM guest load-seed).
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

  const os = osConfigSchema.parse({
    env: ctx.env,
    root: '/tank/rocky',
    repo: ctx.repo,
    quadletUser: user,
    apps: {
      username: user,
      uid,
      gid,
      subuid: ctx.appsSubuid,
      subgid: ctx.appsSubgid,
    },
    timezone: 'Europe/Paris',
    profile: SEED_PROFILE.APPLIANCE,
  })
  const osJson = JSON.stringify(os, null, 2)

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
printf '%s\\n' "APP_ROOT=/tank/rocky/volumes" \\
  > /usr/local/lib/rocky/local-overrides.env
cat > /etc/qctl/config.json <<'EOF'
${osJson}
EOF
chmod 0644 /etc/qctl/config.json
export APP_ROOT=/tank/rocky/volumes
mkdir -p "${home}/.config/containers/containers.conf.d"
cp /etc/containers/containers.conf.d/90-ci-uts.conf \\
  "${home}/.config/containers/containers.conf.d/90-ci-uts.conf"
chown -R "$APPS_USER:$APPS_USER" "${home}/.config"
loginctl enable-linger "$APPS_USER"
systemctl start "user@$(id -u "$APPS_USER").service"
systemctl enable --now podman.socket
runuser -u "$APPS_USER" -- bash -lc 'export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user enable --now podman.socket; podman system migrate >/dev/null 2>&1 || true'
mkdir -p /tank/rocky/volumes
chown -R "$APPS_USER:$APPS_USER" /tank/rocky/volumes
if ! ip link show vlan2 >/dev/null 2>&1; then
  ip link add vlan2 type dummy
fi
ip link set vlan2 up
chown -R "$APPS_USER:$APPS_USER" /tank/rocky/volumes
`
  await execInAppliance(ctx, script)
  logDim('provision complete')
}
