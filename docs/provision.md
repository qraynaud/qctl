# Provision YAML

What goes in `provision/` for an instance: disks, networking, users, repo,
packages, and hypervisor sizing. Keep secrets out of YAML — use `!env NAME` and
put values in `provision/.env.<env>` (see [secrets.md](./secrets.md)).

`qctl init` writes a starter tree. This page lists every schema field (commented
samples below).

## Profiles

Host commands pick env + hypervisor with **`-p` / `--profile`** only. Declare
profiles in **`provision/common.yaml`**:

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

| Field | Meaning |
|-------|---------|
| `environments` | Named envs. Optional `production: true` (default `false`). |
| `profiles` | Named `{ env, target }` (`target`: `workstation` \| `proxmox`). |
| `default-profile` | Used when you omit `-p`. |

If you omit environments/profiles, built-ins apply: envs `dev` + `prod`, profile
`default` → `dev` / `workstation`. With several profiles and no `default-profile`,
`-p` is required. With exactly one profile, that name is the default.

The selected profile sets `QCTL_ENV` for the command (ambient `$QCTL_ENV` does
not choose the profile). `qctl local …` needs a profile with `target: workstation`.

`production: true` on an env tightens destroy prompts, disk warnings, default VM
name, and freezes `node_modules` installs (same as `CI=true`).

## Files and merge order

| File | Put here |
|------|----------|
| `provision/common.yaml` | Shared settings + environments / profiles / default-profile |
| `provision/target-<target>.yaml` | Defaults for that hypervisor |
| `provision/env-<env>.yaml` | Settings shared by profiles using that env |
| `provision/profile-<profile>.yaml` | Settings for one profile (wins last) |
| `provision/.env.schema` | Schema for `!env` keys |
| `provision/.env.<env>` | Secret values (literals / `vw()`); lab values may be committed |
| `provision/.env.local` | Machine-local overrides (gitignored) |

When you run `qctl vm …` / `qctl local …` / seed:

1. Deep-merge present layers (later wins; maps merge by key; **arrays replace**):
   `common.yaml` → `target-<target>.yaml` → `env-<env>.yaml` → `profile-<profile>.yaml`.
2. At least one of those four files must exist.
3. Drop the opposite hypervisor block (`workstation` vs `proxmox`).
4. Resolve every `!env` from process env + `provision/.env.*` (missing keys error;
   empty string is allowed).
5. Validate against the schema below.

```text
provision/common.yaml
provision/target-workstation.yaml
provision/env-dev.yaml
provision/profile-lab.yaml          ← wins last
```

Typical split: shared disks/networking in `common` or `env-*`, CPU/memory or
Proxmox defaults in `target-*`, disk sizes/ids and host IPs in `profile-*`.

## `!env` tag

```yaml
disks:
  tanks:
    tank:
      passphrase: !env TANK_PASSPHRASE

repo:
  # Multiline secrets: store base64 in .env, decode here:
  deploy_key: !env { name: DEPLOY_KEY, encoding: base64 }
```

- `!env NAME` — utf8 value from the host env graph / process.
- `!env { name: NAME, encoding: base64 }` — optional encoding (`utf8` \| `base64` \|
  `hex` \| `latin1` \| `ascii`; default `utf8`).
- `NAME` must be set (empty string OK; unset is an error).
- Guest first-boot names (`tank_passphrase_<poolId>`, `ADMIN_USERNAME`, …) come
  from the resolved YAML fields, not from how you spell the `.env` key.

## Full base sample (`provision/env-dev.yaml`)

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

# Hypervisor blocks usually live in target-*.yaml / profile-*.yaml (below).
# workstation: / proxmox: — the inactive one is stripped for the selected profile.
```

## Layer samples

### `provision/target-workstation.yaml`

```yaml
# Defaults for profiles with target: workstation.

workstation:
  cpu: 2                     # vCPUs (1–256)
  memory: 4096               # MiB (256–1048576)
```

### `provision/profile-lab.yaml`

```yaml
# Overrides for profile "lab" only.

networking:
  vlans:
    vlan2:
      ipv4: 10.42.2.2
```

### `provision/target-proxmox.yaml`

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

```

### How merges behave

```yaml
# Earlier layer had networking.ports.http.forward: 8088
# Later layer:
networking:
  ports:
    http:
      forward: 18088         # only forward changes; port/dnat kept from earlier

# Earlier layer had packages.distro: [nano]
# Later layer:
packages:
  distro: [nano, git]        # whole list replaced (arrays do not append)
```

## Minimal valid base

Only `networking.ports` is required. You can omit everything else (including
`disks:` — then you get the platform OS disk default only):

```yaml
# common.yaml (or any layer):
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

Add `disks:` (see full sample) before `qctl vm init-tank` or an appliance up that
needs persistent volumes. Defaults: admin/apps users, `eth0` uplink, key-only
admin SSH (`ssh.authorized_keys` or `~/.ssh` pubkey). Set `users.admin.password`
(or `passwd` after SSH) for Cockpit password login.

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
