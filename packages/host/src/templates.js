/** Scaffold file contents for `qctl init` / `qctl new`. */

export const GITIGNORE = `# Local overrides (not committed). Active env is QCTL_ENV / --env → .env.dev / .env.prod.
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

# Active provision env (also selectable via --env / QCTL_ENV)
# @type=enum(dev, prod)
# @public
QCTL_ENV=dev

# --- Values from .env.dev / .env.prod ---
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
# users: omitted in provision/dev.yaml → admin/apps defaults (key-only admin; passwd for Cockpit).
# Uncomment users.admin.password: !env ADMIN_PASSWORD in the YAML to use ADMIN_PASSWORD= below.
# ---
TANK_PASSPHRASE=lab-tank-passphrase
SSH_HOST_KEYS=
# ADMIN_PASSWORD=lab
DEPLOY_KEY=lab-deploy-key-placeholder
HEPTAPOD_REGISTRY=
# Required when using --target proxmox (provision/dev.proxmox.yaml):
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

export const PROVISION_DEV_YAML = `# Committable topology. Secrets: !env → provision/.env.<QCTL_ENV>.
# Seed injects tank/admin/repo/ssh/registries as Tier-0 (guest does not resolve vw()).
# Overlay: provision/dev.local.yaml or provision/dev.proxmox.yaml

qctl:
  # Platform adapter (guest import). Version follows the running host (mise).
  # Short name or github:owner/repo[@x.y.z] — e.g. github:qraynaud/platform-ubuntu
  platform: rocky

tank:
  passphrase: !env TANK_PASSPHRASE

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
  # branch: !env REPO_BRANCH

# registries:
#   - !env HEPTAPOD_REGISTRY

networking:
  ports:
    ssh:
      port: 22
      forward: 2222
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

export const PROVISION_DEV_LOCAL_YAML = `# Overlay for --target local (libvirt). Deep-merged onto provision/dev.yaml.

local:
  cpu: 2
  memory: 4096

networking:
  vlans:
    vlan2:
      ipv4: 10.42.2.2
`

export const PROVISION_DEV_PROXMOX_YAML = `# Overlay for --target proxmox. Deep-merged onto provision/dev.yaml.

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

Topology YAML (\`dev.yaml\`, overlays) plus the host env graph
(\`.env.schema\` + \`.env.<env>\`, optional \`.env.local\`).

First-boot secrets are declared in YAML (\`tank\`, \`users.admin\`, \`repo.deploy_key\`, …)
with \`!env\` pointing at this graph. \`users\` is optional (defaults: admin/1000 key-only,
apps/900 + subids). \`qctl vm seed\` resolves on the host and injects Tier-0 credentials
into the guest (no guest-side bootstrap graph).

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
