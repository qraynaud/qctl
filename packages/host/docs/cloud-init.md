# Cloud-init (Rocky 9)

Shared templates for the appliance VM: workstation **NoCloud** seed and **Proxmox**
cloud-init. Same [`user-data.yaml`](../seed/cloud-init/user-data.yaml) intent on both;
networking and how the seed is attached differ.

Seed kit: [`packages/host/seed`](../seed/). VM CLI: [`@qctl/host`](../README.md).
Instance topology stays in the instance repo’s `provision/<env>.yaml`.

## Disk layout

Matches prod appliance roles (lab uses tiny qcow2s; same counts and serials):

| Disk | Count | FS / pool | Role |
|------|-------|-----------|------|
| OS (GenericCloud-Base) | 1 | **XFS** `/` | Disposable OS; rebuild freely |
| `/vw` (`serial=rocky-vw`) | 1 | **XFS** `/vw` | Vaultwarden CLI apodata; **not** on `tank` |
| Data (`rocky-data0`…`4`) | 5 | ZFS **RAIDZ2** | Encrypted pool `tank` capacity |
| Special (`rocky-special0`…`1`) | 2 | ZFS **special mirror** | Metadata/small-block vdev |
| NoCloud seed | 1 | cidata | cloud-init only (ephemeral) |

`vm up` / Proxmox attach **OS + /vw + 5 data + 2 special**. First-boot formats `/vw` if empty and builds/imports `tank` as `raidz2` + `special mirror` by serial/by-id (not bare `vd*`).


## Files

| File | Role |
|------|------|
| [`user-data.yaml`](../seed/cloud-init/user-data.yaml) | Shared `#cloud-config` for appliance + init-tank (`profile` Nunjucks); Tier-0 incl. `TANK_PASSPHRASE` |
| [`meta-data.yaml`](../seed/cloud-init/meta-data.yaml) | NoCloud `instance-id` / `local-hostname` (default `rocky`) |
| [`network-config.yaml`](../seed/cloud-init/network-config.yaml) | Fallback NoCloud net v2; `vm seed` renders from `secrets.networking.uplinks` / `vlans` |

`qctl vm seed` reads `provision/<env>.yaml` + `!env`.
`--profile appliance` (default) vs `--profile init-tank`. Templates use YAML tags resolved at seed build (**cloud-init never sees them**):

| Tag | Meaning |
|-----|---------|
| `!template "…"` | Inline **Nunjucks**. Context: `secrets.*` = secrets YAML; seed-only `env`, `instance_id`, `profile` / `is_init_tank`, `admin_ssh_authorized_keys`, …. Empty output drops that `write_files` entry. Filter: `named`. |
| `!file path` | Embed seed-kit `<path>` (`lib/…`, `first-boot/…`). Nunjucks only if the file contains `{{` / `{%`; empty render drops the entry. |

Bake `secrets/<env>.yaml` into seed as `secrets.*` (e.g. DNAT in `lib/dnat-apply.sh`,
`vlan-parents.env`, `ROCKY_APPS_SUBID_*` / `ROCKY_APPS_SUBGID_*` for `/etc/subuid` +
`/etc/subgid`) — no YAML parsing on the guest.
Appliance users under `users` are optional. Defaults: `admin` (uid/gid 1000; password
omitted → key-only sudo with seed SSH keys / host pubkey fallback) and `apps`
(uid/gid 900; subuid/subgid `<id>×1000:32768`). `gid` defaults to `uid` when omitted.
When `users.admin.password` is omitted the account has **no password** (not a random
one): SSH works with the seeded key, but Cockpit login needs a password — SSH in and
run `passwd` (or set `users.admin.password` in provision) before using Cockpit.
Quadlet templates get apps ids from the instance env graph under whatever names the user defines.

```bash
mise trust   # once, if prompted
mise install
# while Tier-0 is still incomplete:
qctl vm seed --allow-missing-tier0 --allow-missing-files
# with Tier-0 + all !file paths present:
qctl vm seed
```

## Rocky 9 cloud image (pin)

Use **GenericCloud Base** x86_64 (not EC2-specific). Root filesystem is **XFS**.

The pin lives in `@qctl/platform-rocky` as [`cloud-image.json`](../../platform-rocky/cloud-image.json)
(`file` / `url` / `sha256`) and is exported as `CLOUD_IMAGE` from
`qctl-platform-rocky.mjs`. Host does **not** embed it or stage a nameless
`dist/cloud-image.json` — `ensureCloudImage` resolves the selected
`qctl-platform-*.mjs` (GitHub release via `qctl.platform`, checkout `dist/`,
`QCTL_PLATFORM_MODULE` / `QCTL_GUEST_DIST`) and dynamically imports
`CLOUD_IMAGE`. Override with `QCTL_ROCKY_CLOUD_IMAGE` pointing at a JSON file
of the same shape.

Directory: https://download.rockylinux.org/pub/rocky/9/images/x86_64/

Prefer the **dated** filename (not `.latest`) so a silent upstream bump does not
change lab hashes. Bump `packages/platform-rocky/cloud-image.json` deliberately
when you want a newer 9.x cloud image.

Cache downloads under `~/.cache/qctl/images/`.

## Workstation: NoCloud seed

1. Fill `provision/.env.<env>` (Tier-0) + topology in `provision/<env>.yaml`.
2. Run `qctl vm seed` → writes under `~/.cache/qctl/repos/<hash>/seed/<env>/` (ISO labeled `cidata` / `CIDATA` with `user-data`, `meta-data`, `network-config`).
3. Run `qctl vm up` → OS + **/vw** + **5 data** + **2 special** + seed
   (see [`../local/README.md`](../local/README.md) for host packages; `--dry-run` needs none).
4. SSH as the VW Login **`rocky`** username with the injected admin key
   (`PermitRootLogin no`). Impersonate apps: `runuser -u apps -- …`.

NoCloud applies seed-rendered `network-config` (uplinks only from secrets; macvlan parents are dummy ifaces — not 802.1Q on eth0;
fallback template is DHCP on `eth0`). That is the
path that must work on a laptop libvirt/QEMU VM.

## Proxmox: cloud-init drive / snippets

1. Import the same pinned qcow2 once; clone or template as needed.
2. Attach a **cloud-init** drive (Proxmox “Cloud-Init” hardware).
3. Feed **user-data** from [`user-data.yaml`](user-data.yaml) (snippet or paste), after
   the same token substitution `vm seed` would do (admin SSH key, embedded scripts).
4. Set hostname / SSH keys in the Proxmox cloud-init UI **or** snippets — keep them
   consistent with the rendered user-data.
5. Attach **/vw** (small) and **tank** disks: **5 data + 2 special** (same serials/roles as local).

**Networking:** Proxmox `ipconfig0` / cloud-init network fields usually **override**
any NoCloud `network-config`. Prefer the Proxmox UI for lab/prod addressing on
Proxmox VMs; keep [`network-config.yaml`](network-config.yaml) for local NoCloud and
as documentation of the DHCP default. Do not assume the seed’s network file wins on
Proxmox.

## Required secrets / tokens

Rendered into user-data / systemd credentials by `qctl vm seed`:

| Input | Source | Consumed as |
|-------|--------|-------------|
| Admin SSH public key(s) | `ssh.authorized_keys` in `provision/<env>.yaml` (or `~/.ssh` fallback) | `/etc/rocky/admin_ssh_authorized_keys`; `admin-user` stage installs on VW admin (not root) |
| Tier-0 VW credentials | `provision/.env.*` keys with `@tag(guest)` | `/etc/credstore.encrypted/*` + `LoadCredentialEncrypted` on `rocky-first-boot` |
| Pre-clone / registry secrets | [`bootstrap/`](../../bootstrap/) | Baked into seed; used before `hg-clone` |
| Tank passphrase | Prefer omit from seed | `tank-import` / `tank-create` re-seed `/etc/credstore/rocky/tank_passphrase` from bootstrap |

`apps` has **no** SSH keys and **no** sudo. Cockpit/sudo/SSH admin comes from VW Login
`rocky` (`admin-user` stage; `sshd` starts in `start-services`). Root SSH is disabled. Host bootstrap
secrets live on that same Login (fields + attachments). Pool key SoT is field `tank-passphrase`;
the stable on-disk file is for ZFS `keylocation=file://`. SSH host keys SoT is attachment
`ssh-host-keys.tar.gz`. Registry auth: bootstrap `.env.<env>` keys with
`@tag(container-registry)` and value `registry|username|token` — `registry-login`
stage runs `podman login` for root and `apps`.

Heptapod deploy key is bootstrap `DEPLOY_KEY` (prod: `vw("rocky", attachment="heptapod-deploy-key")`).
The `hg-clone` stage writes it under the **admin** `~/.ssh/deploy_key`, then
`hg clone|pull` as that user into `/tank/rocky`. Seed `--env` bakes `QCTL_ENV` into
`/etc/environment.d/91-rocky-env.conf` (first-boot / init-tank units load it). Provision
`repo.vcs` (`git`|`hg`, default `git`) is baked as `ROCKY_REPO_VCS`. Optional
`repo.branch` → `ROCKY_REPO_BRANCH` / `ROCKY_HG_BRANCH`. On **appliance** seed
(`vm up`), `repo.vcs: hg` also adds mercurial+hg-evolve to `packages.pipx` and stock
`/etc/mercurial/hgrc` via provision `files:` (override by listing that path yourself).
Init-tank does not auto-add mercurial.

### `bw` unlock paths (before `tank`)

First-boot secrets come from the seeded bootstrap graph (instance `bootstrap/` →
guest `/usr/local/lib/qctl/bootstrap/`): `TANK_PASSPHRASE`, `SSH_HOST_KEYS`,
`ADMIN_*`, `DEPLOY_KEY`, `@tag(container-registry)`. Prod bindings use `@initVw` +
`vw()`; lab uses literals.
`bw` (if used) comes from provision `packages.http` / `packages.distro`. Extra installs:
`packages.{distro,pipx,http}` in `provision/<env>.yaml` → cloud-init `install-packages.sh`
(appliance + init-tank). `pipx` is installed on the guest only when `packages.pipx` is
non-empty.
Day-2 Podman secrets: `qctl secret sync`. `/usr/local/bin/quadlet` is installed by
`install-qctl-guest.sh`.

1. **Path A:** `/vw` already has CLI vault data → Tier-0 unlocks offline → `tank-import` re-seeds tank key file if missing → import/mount (VW need not be up). Keep the `/vw` disk across OS rebuilds.
2. **Path B:** empty `/vw` → login+sync to a **reachable** VW → then same.

**Reboot (normal):** `zfs-import*` imports the pool; **`zfs-mount-generator`** emits
`zfs-load-key@tank.service` from `/etc/zfs/zfs-list.cache/tank` (needs `zfs-zed`), then mounts.
Key file: `file:///etc/credstore/rocky/tank_passphrase`. Vendor `zfs-load-key.service` is a
`/dev/null` stub — do not unmask it; there is no real unit underneath.

**Export/import drill (`zfs-drill` stage):** `zpool export` → import → unlock → verify `/tank/.rocky-canary`. Skip with `ROCKY_SKIP_ZFS_DRILL=1`.

Never put Vaultwarden CLI apodata (`@initVw(appDataDir=…)`) on encrypted `tank`.
On-box VW **container** data belongs on `/tank`.

## After first boot (expectation)

cloud-init installs the guest tooling from the NoCloud ISO (`lib/install-qctl-guest.sh`:
`qctl-guest` → `/usr/local/bin/qctl`, `qctl-platform-rocky.mjs` → `/usr/local/lib/qctl/` (guest import),
`varlock-local-encrypt` (SEA sibling for disk cache; no varlock CLI), bootstrap under
`/usr/local/lib/qctl/`, then **`qctl plugins ensure`**
so bootstrap `# @plugin` pins land in `/root/.config/varlock/plugins-cache`), installs packages,
enables linger for `apps`, installs OpenZFS, runs `install-packages.sh` (Mercurial via
pipx when `repo.vcs: hg` on appliance), enables
`rocky-tier0-seal` + `rocky-first-boot`, then **`wait-qctl-init.sh`** runs
`systemctl start rocky-first-boot` (plain start — oneshot already waits for ExecStart;
do not use `start --wait` with `RemainAfterExit=yes` or cloud-final hangs forever) and
**requires** `/var/lib/rocky/first-boot.done`. If `qctl init` fails, that script exits
non-zero so **`cloud-init status` is error** (not a false “done”). The same script is
installed as `scripts/per-boot/90-rocky-wait-qctl-init.sh` so a reboot mid-runcmd cannot
skip the gate: once the unit is enabled, every boot waits for the stamp until it exists.
The unit runs **`qctl init`** (stages live in `qctl-guest`):

```
network-up → host-baseline (+/vw) → tier0-seal → ssh-host-keys → admin-user
→ start-services → registry-login → tank-import → zfs-drill → hg-clone → ready-stamp
```

`vm init-tank` runs `qctl init --profile init-tank` (`vw-mount → tank-create → poweroff`).
Resume after a failure with `qctl init --from <stage>`; preview with `qctl init --dry-run`.
`rocky-tier0-seal.service` stays a separate unit (it must seal credentials *before*
`LoadCredentialEncrypted=` on the init unit loads them) and calls
`qctl stage tier0-seal`; the stage is idempotent inside `qctl init`.
Tier-0 / provision secrets are declared in `provision/.env.schema` (scaffold via
`qctl init`).

`qctl vm seed` builds `nocloud.iso` (volume label `cidata`, Joliet) in-process via
`@gcu/iso9660` — no `genisoimage` / `xorriso` / FAT fallback.

Guest tooling is staged into `qctl-guest/` on that ISO from, in order:
`QCTL_GUEST_DIST`, the local qctl checkout’s `dist/` (when the host is running from
that repo), otherwise the GitHub release (`qctl-guest`, `qctl-platform-*.mjs`).
`varlock-local-encrypt` is embedded in `qctl-host` and copied onto the seed from the
host materialize path (not a separate release asset).
