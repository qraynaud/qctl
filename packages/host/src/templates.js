/** Scaffold file contents for `qctl init` / `qctl new`. */

export const GITIGNORE = `# Local overrides (not committed). Active env is QCTL_ENV from the
# selected provision profile (--profile / -p) → .env.dev / .env.prod / .env.<env>.
# VM/seed/image caches live under ~/.cache/qctl and ~/.local/share/qctl (not in-repo).
.env
.env.local
.env.*.local
# (includes provision/.env.local — machine-local host provision overrides)

# Value files (.env.dev, .env.prod, .env.app, .env.<unit>) and every .env.schema are
# committed. Secrets are schema items (sensitive by default); use @public for non-secrets
# and @optional when empty is allowed.

node_modules/
`

export const MISE_TOML = `# Host qctl on PATH via mise. No varlock CLI — the graph API is bundled into qctl-host.
# Activate with \`mise install\` (or direnv / mise activate) in this repo.
# \`qctl vm seed\` builds the NoCloud ISO in-process (bundled ISO writer).

[tools]
# GitHub release asset \`qctl-host\` → command \`qctl\` on PATH.
"github:qraynaud/qctl" = { version = "latest", asset_pattern = "qctl-host", bin = "qctl" }
`

export const ROOT_ENV_SCHEMA = `# Instance root schema. \`loadEnvGraphForDir\` uses this directory as the graph entry;
# \`.env.<QCTL_ENV>\` autoloads via \`currentEnvFallback\` (do not also # @import the same file).
# Package schemas @import(../../) this directory for shared values.
# Unmarked items are sensitive + required. Use @public / @optional per item.
# ---

# Active env name — set from the selected provision profile (\`qctl … --profile\` / \`-p\`).
# Open string (any key under qctl.environments); scaffold keeps .env.dev / .env.prod.
# @type=string
# @public
QCTL_ENV=dev

# --- Values from .env.<QCTL_ENV> (e.g. .env.dev / .env.prod) ---
# Declare every key those files set as internal: usable for Quadlet \${VAR} substitution and
# schema refs, never injected into the process env.

# @internal @public @optional
ENV=
# @internal @public @optional
TANK_ROOT=
# @internal @public @optional
TZ=
`

/** Host/provision env schema (resolved at seed; !env from YAML). */
export const PROVISION_ENV_SCHEMA = `# Host / provision secret graph (not imported by app/unit graphs).
# Wire into provision/*.yaml with !env. Seed injects first-boot slots as Tier-0.
# disks.tanks.<id>.passphrase: !env TANK_PASSPHRASE → guest tank_passphrase_<id>.
# ---

TANK_PASSPHRASE=
# @optional
SSH_HOST_KEYS=
# Optional — wire via users.admin in provision/*.yaml when you want them
# @optional
ADMIN_USERNAME=
# @optional
ADMIN_PASSWORD=
# @public @optional
ADMIN_UID=
# @public @optional
ADMIN_GID=
DEPLOY_KEY=
# @optional
HEPTAPOD_REGISTRY=
# @optional
PROXMOX_API_TOKEN=
# @public @optional
REPO_BRANCH=
`

export const PROVISION_ENV_DEV = `# Lab host bindings for provision !env (QCTL_ENV=dev).
# users: omitted in provision/env-dev.yaml → admin/apps defaults (key-only admin; passwd for Cockpit).
# Uncomment users.admin.password: !env ADMIN_PASSWORD in the YAML to use ADMIN_PASSWORD= below.
# ---
# Wired by disks.tanks.tank.passphrase: !env TANK_PASSPHRASE (→ tank_passphrase_tank).
TANK_PASSPHRASE=lab-tank-passphrase
SSH_HOST_KEYS=
# ADMIN_PASSWORD=lab
DEPLOY_KEY=lab-deploy-key-placeholder
HEPTAPOD_REGISTRY=
# Required for proxmox-target profiles (provision/target-proxmox.yaml):
# PROXMOX_API_TOKEN=
`

export const PROVISION_ENV_PROD = `# Prod host bindings — enable vw() when ready (see docs/secrets.md):
#   Add "@qctl/vaultwarden-plugin" to package.json dependencies, then:
#   # @plugin(@qctl/vaultwarden-plugin)
#   # @initVw(serverUrl=https://vw.example/, sessionTtl=1h, cacheTtl=5m)
#   TANK_PASSPHRASE=vw("rocky", field="tank-passphrase")
#   DEPLOY_KEY=vw("rocky", attachment="heptapod-deploy-key")
# ---
TANK_PASSPHRASE=
SSH_HOST_KEYS=
# Uncomment users.admin in provision YAML to wire these:
# ADMIN_USERNAME=
# ADMIN_PASSWORD=
DEPLOY_KEY=
HEPTAPOD_REGISTRY=
# PROXMOX_API_TOKEN=
`

/** Instance package.json — add plugin deps when enabling \`# @plugin\` (see docs/secrets.md). */
export const PACKAGE_JSON = `{
  "name": "qctl-instance",
  "private": true,
  "type": "module",
  "dependencies": {}
}
`

/** Non-secret root values for QCTL_ENV=dev (literal values: varlock, not bash \`source\`). */
export const ROOT_ENV_DEV = `ENV=dev
TANK_ROOT=./volumes
TZ=UTC
`

/** Non-secret root values for QCTL_ENV=prod (package schemas import the repo root). */
export const ROOT_ENV_PROD = `# Shared prod values. For Vaultwarden unlock + vw() in unit graphs:
#   # @plugin(@qctl/vaultwarden-plugin)
#   # @initVw(appDataDir=/vw, clientId=$VW_CLIENT_ID, clientSecret=$VW_CLIENT_SECRET, masterPassword=$VW_MASTER_PASSWORD, cacheTtl=5m)
# List the plugin in package.json dependencies (version via lockfile). See docs/secrets.md.
# ---
ENV=prod
TANK_ROOT=/tank/apps
TZ=UTC
`

/**
 * Per-package schema: import repo root (shared .env.dev / .env.prod), optional local files.
 * Local \`.env.<ENV>\` autoloads via directory entry. Mark non-secrets \`@public\`.
 * Unit schemas should \`# @import(../../../)\` (three levels up to root).
 * @param {'applications' | 'common' | 'networks'} kind
 * @param {string} name
 */
export function treeEnvSchema(kind, name) {
  return [
    '# Import root .env.schema (+ .env.dev / .env.prod by QCTL_ENV). Local .env.<ENV> autoloads.',
    '# @import(../../)',
    ...(kind === 'applications' ? ['# @import(./.env.app, allowMissing=true)'] : []),
    `# @import(./.env.${name}, allowMissing=true)`,
    '# ---',
    '',
    '# Secrets are sensitive by default (Podman sync). Mark non-secrets @public / @optional.',
    '# Never assign secrets in .env.app* / .env.<unit>*.',
    '',
  ].join('\n')
}

/** Shared foundation layer + host meta (environments / profiles). Always merged first. */
export const PROVISION_COMMON_YAML = `# Shared foundation (common → target-* → env-* → profile-*).
# qctl.environments / qctl.profiles / qctl.default-profile are read from this file only.
# Built-ins when omitted: environments {dev, prod: {production: true}},
# profiles {default: {env: dev, target: workstation}}.

qctl:
  # Platform adapter (guest import). Version follows the running host (mise).
  # Short name or github:owner/repo[@x.y.z] — e.g. github:qraynaud/platform-ubuntu
  platform: rocky
  # environments:
  #   lab: {}
  #   prod: { production: true }
  # profiles:
  #   lab:  { env: lab,  target: workstation }
  #   prod: { env: prod, target: proxmox }
  # default-profile: lab
`

export const PROVISION_DEV_YAML = `# Env layer (dev). Secrets: !env → provision/.env.<QCTL_ENV>.
# Seed injects disks.tanks.*.passphrase → tank_passphrase_<poolId>, plus
# admin/repo/ssh/registries as Tier-0 (guest does not resolve vw()).
# Target / profile leaves: provision/target-*.yaml, provision/profile-*.yaml
# Platform + profiles: see provision/common.yaml

# OS + persistent data volumes + ZFS tanks. Member map keys become disk serials.
# size → virtual disk; omit size → bind a physical disk (Proxmox / by-id).
# Create pools only via \`qctl vm init-tank\` (never on appliance first boot).
disks:
  os:
    size: 20G
  data:
    vw:
      mount: /vw
      size: 2G
      # fs: xfs   # optional; default = platform DEFAULT_FS
  tanks:
    tank:
      mount: /tank
      passphrase: !env TANK_PASSPHRASE
      # options: {}  # pool/dataset/acl defaults applied at resolve
      vdevs:
        data:
          role: data
          type: raidz2
          members:
            data1: { size: 2G }
            data2: { size: 2G }
            data3: { size: 2G }
            data4: { size: 2G }
            data5: { size: 2G }
        special:
          role: special
          type: mirror
          members:
            special1: { size: 1G }
            special2: { size: 1G }

# users:  # optional — defaults: admin (uid 1000), apps (uid 900, subids <id>×1000:32768)
#   admin:
#     username: admin
#     password: !env ADMIN_PASSWORD
#   apps:
#     username: apps
#     # uid: 900
#     # gid: 900   # defaults to uid when omitted
#     # subuid: 900000:32768
#     # subgid: 900000:32768

# ssh:
#   authorized_keys:
#     - ssh-ed25519 AAAA... user@host
#   host_keys: !env SSH_HOST_KEYS

repo:
  vcs: hg
  url: ssh://git@git.example/org/repo
  dir: /tank/rocky
  deploy_key: !env DEPLOY_KEY
  # deploy_key: !env { name: DEPLOY_KEY, encoding: base64 }
  # branch: !env REPO_BRANCH

# registries:
#   - !env HEPTAPOD_REGISTRY

networking:
  ports:
    ssh:
      port: 22
      forward: 2222
    cockpit:
      port: 9090
      forward: 9090
    http:
      port: 80
      forward: 8088
      dnat: 8088
    https:
      port: 443
      forward: 8443
      dnat: 8443
  uplinks:
    eth0:
      dhcp4: true
  vlans:
    vlan2:
      id: 2
      link: eth0

# Guest file drops → cloud-init write_files (defaults: owner root:root, permissions 0644):
# files:
#   - path: /etc/example.conf
#     content: |
#       key=value

# Extra packages by install source (after cloud-init baseline):
# packages:
#   distro:           # OS package manager (dnf / apt / …)
#     - nano
#   http:             # URL → binary (zip member or raw)
#     - url: https://example.com/releases/bw-linux.zip
#       bin: bw
#       test: '[[ "$($APP --version)" == "2025.11.0" ]]'
#   pipx:             # optional; pipx is installed on the guest only if this list is non-empty
#     - cowsay

# On appliance seed (vm up), repo.vcs: hg → packages.pipx gets mercurial==7.1.2 +
# hg-evolve, and files gets stock /etc/mercurial/hgrc (unless that path is listed).
`

export const PROVISION_DEV_WORKSTATION_YAML = `# Target layer for workstation (libvirt). Merged after common, before env-*.

workstation:
  cpu: 2
  memory: 4096

networking:
  vlans:
    vlan2:
      ipv4: 10.42.2.2
`

export const PROVISION_DEV_PROXMOX_YAML = `# Target layer for proxmox. Merged after common, before env-*.

proxmox:
  api_url: https://pve.example:8006
  api_token: !env PROXMOX_API_TOKEN
  node: pve
  cpu: 2
  memory: 4096
  net:
    eth0:
      bridge: vmbr0
      trunks: [2]

networking:
  vlans:
    vlan2:
      ipv4: 10.0.2.2
`

export const PROVISION_README = `# provision/

Merge order: \`common.yaml\` → \`target-<target>.yaml\` → \`env-<env>.yaml\` →
\`profile-<profile>.yaml\` (later wins). Host meta (\`qctl.environments\` /
\`qctl.profiles\` / \`qctl.default-profile\`) is read from \`common.yaml\` only; omit
them to use built-ins. Select a profile with \`qctl … --profile\` / \`-p\` (sets
\`QCTL_ENV\` from the profile’s env).

Topology YAML plus the host env graph (\`.env.schema\` + \`.env.<env>\`, optional
\`.env.local\`). Disk topology lives under \`disks:\` (\`os\` / \`data\` / \`tanks\`).
Encrypted tank passphrases are \`disks.tanks.<id>.passphrase: !env …\` — seed writes
Tier-0 \`tank_passphrase_<id>\` (not a top-level \`tank:\` block). Other first-boot
slots (\`users.admin\`, \`repo.deploy_key\`, …) use the same \`!env\` graph. \`users\` is
optional (defaults: admin/1000 key-only, apps/900 + subids). \`qctl vm seed\`
resolves on the host and injects Tier-0 into the guest (no guest-side bootstrap
graph). Create ZFS pools with \`qctl vm init-tank\`; appliance boots import only.

Host caches are **not** here — they live under XDG:

- \`~/.cache/qctl/images/\` — cloud base images
- \`~/.cache/qctl/repos/<hash>/seed/\` — NoCloud ISO / instance-id
- \`~/.cache/qctl/tooling/\` — materialized seed-kit (compiled host)
- \`~/.local/share/qctl/repos/<hash>/vms/\` — VM disks

\`<hash>\` is derived from the absolute path of this instance root.
`

/**
 * @param {'applications' | 'common' | 'networks'} kind
 * @param {string} name
 */
export function packageReadme(kind, name) {
  return `# ${name}\n\nScaffolded by \`qctl new ${kind === 'applications' ? 'app' : kind === 'networks' ? 'network' : 'common'} ${name}\`.\n`
}
