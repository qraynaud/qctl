# Provision YAML

Committable topology for an instance: networking, users, tank, repo, packages, and
hypervisor sizing. Secrets stay out of the YAML — use `!env NAME` and resolve values
from `provision/.env.<QCTL_ENV>` (see [secrets.md](./secrets.md)).

`qctl init` writes a minimal starter under `provision/`. This page documents **every**
schema field, mainly via commented samples.

## Files and load order

| File | Role |
|------|------|
| `provision/<env>.yaml` | Base topology for `QCTL_ENV` / `--env` (required), e.g. `dev.yaml` |
| `provision/<env>.<target>.yaml` | Optional overlay for `--target local` or `proxmox` |
| `provision/.env.schema` | Host graph schema for keys used by `!env` |
| `provision/.env.<env>` | Host values (literals / `vw()`); committed lab values OK |
| `provision/.env.local` | Machine-local host overrides (gitignored) |

Load algorithm (`qctl vm …`, `qctl local …`, seed):

1. Parse `provision/<env>.yaml`.
2. If `provision/<env>.<target>.yaml` exists, **deep-merge** it onto the base
   (maps merge by key; **arrays are replaced** by the overlay).
3. Drop the opposite hypervisor block (`local` vs `proxmox`).
4. Resolve every `!env NAME` from process env + `provision/.env.*` graph
   (empty process values do not win; missing keys error).
5. Validate against the secrets schema (below). The `qctl:` block is host metadata
   and is stripped before that validation.

```text
provision/dev.yaml              ← base (all targets)
provision/dev.local.yaml        ← merged when --target local
provision/dev.proxmox.yaml      ← merged when --target proxmox
```

There is no third overlay layer beyond `<env>.<target>.yaml`. Prefer keeping shared
topology in the base file and target-only knobs (`local:` / `proxmox:`, VLAN host
IPs, API tokens) in the overlay.

## `!env` tag

```yaml
tank:
  passphrase: !env TANK_PASSPHRASE
```

- `NAME` must exist in the merged host env (graph and/or process).
- Empty string is allowed (optional slots); **unset** is an error.
- Name the host keys however you like; Tier-0 guest names (`TANK_PASSPHRASE`,
  `ADMIN_USERNAME`, …) are assigned from the **resolved YAML**, not from your
  `.env` key spelling.

## Full base sample (`provision/dev.yaml`)

Every supported top-level key and nested field. Omit anything optional — defaults
are noted in comments. Copy and trim for real instances.

```yaml
# --- Host metadata (not part of the guest secrets schema) ---
qctl:
  # Platform adapter for guest tooling. Short name or github:owner/repo[@x.y.z]
  # Default when omitted at resolve time: rocky
  platform: rocky
  # platform: github:qraynaud/platform-ubuntu
  # platform: github:qraynaud/platform-rocky@1.2.3

# --- ZFS tank passphrase (Tier-0). Omit block only if you never create/reseed the tank. ---
tank:
  passphrase: !env TANK_PASSPHRASE

# --- SSH seed material ---
ssh:
  # Pubkeys installed for the admin user. Omit → host falls back to ~/.ssh/id_*.pub
  authorized_keys:
    - ssh-ed25519 AAAA... you@laptop
    # Or a single multi-line string:
    # authorized_keys: |
    #   ssh-ed25519 AAAA... a
    #   ssh-ed25519 BBBB... b
  # Optional gzip tar of /etc/ssh/ssh_host_* (often base64 via !env)
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
# local: / proxmox: may appear here; the inactive one is stripped for the active --target.
```

## Overlay samples

### `provision/dev.local.yaml` (`--target local`)

```yaml
# Deep-merged onto provision/dev.yaml for libvirt / qctl local.
# Arrays in this file replace the base array; maps merge by key.

local:
  cpu: 2                     # vCPUs (1–256)
  memory: 4096               # MiB (256–1048576)

networking:
  vlans:
    vlan2:
      # Override / add host-side IPv4 for this VLAN only on local
      ipv4: 10.42.2.2
```

### `provision/dev.proxmox.yaml` (`--target proxmox`)

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

`networking.ports` is the only required topology. Everything else can be omitted:

```yaml
qctl:
  platform: rocky

tank:
  passphrase: !env TANK_PASSPHRASE

networking:
  ports:
    ssh:
      port: 22
      forward: 2222

repo:
  url: ssh://git@git.example/org/repo
  deploy_key: !env DEPLOY_KEY
```

That yields default `admin` / `apps`, default `eth0` uplink, and key-only admin
(SSH via `ssh.authorized_keys` or the host pubkey fallback). Set
`users.admin.password` (or SSH in and `passwd`) before Cockpit password login.

## Related

- [secrets.md](./secrets.md) — host `!env` graph vs guest Tier-0 vs Podman `@sensitive`
- [instance.md](./instance.md) — repo layout
- [packages/host/docs/cloud-init.md](../packages/host/docs/cloud-init.md) — seed / cloud-init bake
- Schema sources: `packages/host/src/vm/libs/secrets-schema/`
