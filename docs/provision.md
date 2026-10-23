# Provision YAML

Committable topology for an instance: `disks`, networking, users, repo, packages, and
hypervisor sizing. Secrets stay out of the YAML — use `!env NAME` and resolve values
from `provision/.env.<QCTL_ENV>` (see [secrets.md](./secrets.md)).

`qctl init` writes a minimal starter under `provision/`. This page documents **every**
schema field, mainly via commented samples.

## Profiles (env + target)

Host commands select env and hypervisor target **only** by **profile**
(`qctl … --profile` / `-p`).

Declare them under `qctl:` in **`provision/common.yaml` only** (bootstrap SoT):

```yaml
qctl:
  platform: rocky
  environments:
    lab: {}
    staging: {}
    prod: { production: true }
  profiles:
    lab:     { env: lab,     target: workstation }
    staging: { env: staging, target: proxmox }
    prod:    { env: prod,    target: proxmox }
  default-profile: lab
```

| Field | Role |
|-------|------|
| `environments` | Open map of env names. Optional `production: true` (default `false`). |
| `profiles` | Named `{ env, target }` pairs (`target`: `workstation` \| `proxmox`). |
| `default-profile` | Profile key used when `--profile` is omitted. |

**Built-ins when omitted:** environments `{ dev, prod: { production: true } }`,
profiles `{ default: { env: dev, target: workstation } }` (so a fresh init works with
`--profile` omitted).

**Default profile key:** `default-profile` if set; else the sole profile key if
the map has exactly one entry; else `--profile` is required.

After resolve, qctl sets internal `env` / `target` / `production` and
`QCTL_ENV=<profile.env>` for varlock / host-env loads (profile is SoT for the
command — ambient `$QCTL_ENV` does not pick the profile).

`qctl local …` requires a profile whose `target` is `workstation`.

**Production flag** (`production: true` on an env) drives destroy confirm, disk
warnings, Proxmox attach tip, default VM name, and frozen plugin installs.
Frozen `node_modules` installs: `CI=true` **or** `production: true` on the
active env (non-production custom envs such as `staging` stay mutable unless CI).

Reserved env / profile basenames: `common`, `workstation`, `proxmox` (layer names).

## Files and load order

| File | Role |
|------|------|
| `provision/common.yaml` | Shared foundation + `qctl.environments` / `profiles` / `default-profile` |
| `provision/<target>.yaml` | Target layer, e.g. `workstation.yaml` / `proxmox.yaml` |
| `provision/<env>.yaml` | Env layer for the profile’s `env`, e.g. `dev.yaml` |
| `provision/<env>.<target>.yaml` | Most-specific overlay, e.g. `dev.workstation.yaml` |
| `provision/.env.schema` | Host graph schema for keys used by `!env` |
| `provision/.env.<env>` | Host values (literals / `vw()`); committed lab values OK |
| `provision/.env.local` | Machine-local host overrides (gitignored) |

Load algorithm (`qctl vm …`, `qctl local …`, seed) after profile resolve:

1. **Deep-merge** present layers in this order (later wins; maps merge by key;
   **arrays are replaced** by the later file):
   `common.yaml` → `<target>.yaml` → `<env>.yaml` → `<env>.<target>.yaml`.
2. At least one of those four files must exist (any combination is fine).
3. Drop the opposite hypervisor block (`workstation` vs `proxmox`).
4. Resolve every `!env` from process env + `provision/.env.*` graph to a
   `Buffer` (empty process values do not win; missing keys error).
5. Validate against the provision schema (below).

```text
provision/common.yaml           ← foundation + host meta (profiles)
provision/workstation.yaml            ← target (before env)
provision/dev.yaml              ← env (wins over target)
provision/dev.workstation.yaml        ← env+target (always last)
```

Prefer shared topology and profiles in `common.yaml`, target-wide knobs in
`<target>.yaml`, env knobs in `<env>.yaml`, and env+target specifics in the overlay.

## `!env` tag

```yaml
disks:
  tanks:
    tank:
      passphrase: !env TANK_PASSPHRASE   # → Tier-0 tank_passphrase_tank

repo:
  # CI / process env cannot hold newlines — store base64, decode at resolve:
  deploy_key: !env { name: DEPLOY_KEY, encoding: base64 }
```

- Scalar form: `!env NAME` (utf8).
- Mapping form: `!env { name: NAME, encoding: base64 }` (`encoding` optional;
  one of `utf8` | `base64` | `hex` | `latin1` | `ascii`; default `utf8`).
- Resolves to a `Buffer` (`Buffer.from(env[NAME], encoding)`). Seed writers accept
  `Buffer | string` and encode Tier-0 `write_files` appropriately.
- `NAME` must exist in the merged host env (graph and/or process).
- Empty string is allowed (optional slots); **unset** is an error.
- Name the host keys however you like; Tier-0 guest names (`tank_passphrase_<poolId>`,
  `ADMIN_USERNAME`, …) are assigned from the **resolved YAML**, not from your
  `.env` key spelling.

## Full base sample (`provision/dev.yaml`)

Every supported top-level key and nested field. Omit anything optional — defaults
are noted in comments. Copy and trim for real instances.

```yaml
# Prefer qctl.platform (+ environments / profiles) in provision/common.yaml.
# Env layers may still set platform if you need an override.

# --- Disk topology (optional; omit → platform OS default only, no data/tanks yet) ---
# Member map keys become disk serials. size → virtual disk; omit size → physical bind.
# Create ZFS pools only via `qctl vm init-tank` (appliance boots import+unlock only).
# ≥1 data volume or tank required when disks: is present. Mounts and ids must be unique.
disks:
  os:
    # id: os                 # optional; default "os"
    size: 20G                # optional; platform default when omitted
  data:
    vw:
      # id: vw               # optional; default = map key
      mount: /vw
      size: 2G
      # fs: xfs              # optional; default = platform DEFAULT_FS
  tanks:
    tank:
      # id: tank             # optional; default = map key (also the zpool name)
      mount: /tank
      passphrase: !env TANK_PASSPHRASE   # → Tier-0 tank_passphrase_tank
      # options: {}          # pool/dataset/acl defaults applied at resolve
      vdevs:
        data:                # ≥1 vdev with role: data required per tank
          role: data         # data | special (registry)
          type: raidz2       # single | mirror | raidz | raidz2 | raidz3
          members:           # geometry mins enforced (raidz2 ≥ 3, …)
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

# --- SSH seed material ---
ssh:
  # Pubkeys installed for the admin user. Omit → host falls back to ~/.ssh/id_*.pub
  authorized_keys:
    - ssh-ed25519 AAAA... you@laptop
    # Or a single multi-line string:
    # authorized_keys: |
    #   ssh-ed25519 AAAA... a
    #   ssh-ed25519 BBBB... b
  # Optional gzip tar of /etc/ssh/ssh_host_* (base64 transport → bytes):
  # host_keys: !env { name: SSH_HOST_KEYS, encoding: base64 }
  host_keys: !env SSH_HOST_KEYS

# --- Users (entire section optional) ---
# Defaults if omitted:
#   admin → username admin, uid/gid 1000, no password (SSH key-only)
#   apps  → username apps, uid/gid 900, subuid/subgid <id>×1000:32768
# gid defaults to uid when only uid is set; only-gid keeps the default uid.
# No admin.password → empty password (not random). SSH works with keys; for Cockpit
# run `passwd` over SSH or set password here.
users:
  admin:
    username: admin          # optional; default admin (must not collide with apps)
    password: !env ADMIN_PASSWORD   # optional; omit for key-only + NOPASSWD sudo
    uid: 1000                # optional; default 1000
    gid: 1000                # optional; default = uid
  apps:
    username: apps           # optional; default apps (POSIX name; not root/admin/…)
    uid: 900                 # optional; default 900
    gid: 900                 # optional; default = uid
    # start:count — count in 1…32768. Default start = uid×1000 (or gid×1000).
    subuid: 900000:32768
    subgid: 900000:32768

# --- Instance clone on the guest ---
repo:
  vcs: git                   # optional; git | hg (default git). hg also seeds mercurial pipx + hgrc
  url: ssh://git@git.example/org/repo
  dir: /tank/rocky           # optional guest checkout path (default /tank/rocky)
  branch: !env REPO_BRANCH   # optional
  deploy_key: !env DEPLOY_KEY
  # CI without newlines: !env { name: DEPLOY_KEY, encoding: base64 }

# --- podman login lines → Tier-0 ROCKY_REGISTRIES JSON ---
# Each string: registry|username|token
registries:
  - !env HEPTAPOD_REGISTRY
  # - registry.example|robot|token

# --- Networking (required) ---
networking:
  # Named map → list. At least one port. Keys become .name
  ports:
    ssh:
      port: 22               # guest listen / DNAT target default
      forward: 2222          # host forward (passt / local -p). Omit → no host publish
      # dnat: 22             # optional; DNAT dest inside guest (default = port)
    http:
      port: 80
      forward: 8088
      dnat: 8088
    https:
      port: 443
      forward: 8443
      dnat: 8443
    cockpit:
      port: 9090
      forward: 9090
    # App ports follow the same shape; qctl local skips publishing ssh + cockpit

  # Uplinks (optional; default one eth0 with dhcp4: true)
  uplinks:
    eth0:
      dhcp4: true            # optional; default true

  # Guest VLAN ifaces (optional). Name must not collide with an uplink.
  # link required when more than one uplink exists; else defaults to the sole uplink.
  vlans:
    vlan2:
      id: 2                  # 1–4094
      link: eth0             # parent uplink name
      ipv4: 10.42.2.2        # optional host address on this VLAN (macvlan peers)

# --- Extra packages after platform baseline (optional) ---
packages:
  distro:                    # dnf / apt / …
    - nano
  pipx:                      # pipx installed on guest only if this list is non-empty
    - cowsay
    - package: some-tool==1.0.0
      inject:                # optional pipx inject deps
        - plugin-a
  http:                      # URL → binary (zip member or raw)
    - url: https://example.com/releases/bw-linux.zip
      bin: bw                # zip member and/or /usr/local/bin name
      # dest: /usr/local/bin/bw   # absolute path alternative to bin
      test: '[[ "$($APP --version)" == "2025.11.0" ]]'

# --- Guest file drops → cloud-init write_files (optional) ---
# Defaults: owner root:root, permissions 0644. path must be absolute.
# repo.vcs: hg prepends /etc/mercurial/hgrc unless that path is listed (your entry wins).
files:
  - path: /etc/example.conf
    owner: root:root
    permissions: "0644"      # or mode: 644
    content: |
      key=value

# --- Hypervisor sizing in the *base* file is unusual; prefer overlays (below). ---
# workstation: / proxmox: may appear here; the inactive one is stripped for the profile target.
```

## Overlay samples

### `provision/dev.workstation.yaml` (profile `target: workstation`)

```yaml
# Deep-merged onto provision/dev.yaml for libvirt / qctl local (workstation target).
# Arrays in this file replace the base array; maps merge by key.

workstation:
  cpu: 2                     # vCPUs (1–256)
  memory: 4096               # MiB (256–1048576)

networking:
  vlans:
    vlan2:
      # Override / add host-side IPv4 for this VLAN only on workstation
      ipv4: 10.42.2.2
```

### `provision/dev.proxmox.yaml` (profile `target: proxmox`)

```yaml
proxmox:
  api_url: https://pve.example:8006
  api_token: !env PROXMOX_API_TOKEN   # must be set (non-empty) before seed/up
  node: pve
  storage: local-lvm                 # optional
  image_storage: local               # optional
  vmid: 120                          # optional
  cpu: 2
  memory: 4096
  # One NIC entry per networking.uplinks key (required if net: is present).
  # tag/vlan OR trunks — not both. trunks: ids or "10-20" ranges.
  net:
    eth0:
      bridge: vmbr0
      # tag: 2                 # access VLAN
      trunks: [2]              # or trunks: ["2-10", 20]
      # mac: aa:bb:cc:dd:ee:ff
      # vlan: 2                # alias of tag

networking:
  vlans:
    vlan2:
      # VLAN id must be carried by proxmox.net.<link> tag or trunks
      ipv4: 10.0.2.2
```

### Overlay merge rules (examples)

```yaml
# base networking.ports.http.forward: 8088
# overlay:
networking:
  ports:
    http:
      forward: 18088         # merges → only forward changes; port/dnat kept from base

# base packages.distro: [nano]
# overlay:
packages:
  distro: [nano, git]        # replaces entire distro list (arrays do not append)
```

## Minimal valid base

`networking.ports` is the only required topology. Everything else can be omitted
(including `disks:` — resolve then uses the platform OS default only):

```yaml
# common.yaml (or this file):
qctl:
  platform: rocky

networking:
  ports:
    ssh:
      port: 22
      forward: 2222

repo:
  url: ssh://git@git.example/org/repo
  deploy_key: !env DEPLOY_KEY
```

Add a `disks:` block (see full sample) before `qctl vm init-tank` / appliance up with
persistent volumes. Default `admin` / `apps`, default `eth0` uplink, and key-only admin
(SSH via `ssh.authorized_keys` or the host pubkey fallback). Set
`users.admin.password` (or SSH in and `passwd`) before Cockpit password login.

## Lifecycle (disks)

| Command | Role |
|---------|------|
| `qctl vm init-tank [poolId…]` | Only path that `zpool create`s. Bare = all `disks.tanks`; `-f` recreates. |
| `qctl vm up` | Appliance: import + unlock + mount from topology (never create). |
| `qctl vm up --wipe-os` | Recreate OS disk only; keep `disks.data` + tank members. |
| `qctl vm destroy --keep-persistent` | Drop OS; keep data volumes + tank members. Full wipe needs confirm on production envs. |

## Related

- [secrets.md](./secrets.md) — host `!env` graph vs guest Tier-0 vs Podman `@sensitive`
- [instance.md](./instance.md) — repo layout
- [packages/host/docs/cloud-init.md](../packages/host/docs/cloud-init.md) — seed / cloud-init bake
- Schema sources: `packages/host/src/provision/schema/`
