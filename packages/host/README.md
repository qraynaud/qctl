# `@qctl/host`

Workstation **host** CLI — shipped as the `qctl-host` release asset and installed as
`qctl` on PATH (via mise).

Scaffold an instance repo, then drive the appliance VM from `provision/*.yaml`.

## Getting started

Prefer **cloning** an existing instance remote (**git** or **hg**), then `cd` into it.
Starting from an empty directory (optional `git init` / `hg init`) works too.

Same path as `qctl --help` after that (do **not** start with `qctl local` — that is
Podman without a VM):

```bash
qctl init .                 # Quickstart lab (or Custom); checks host deps; offers init-tank
qctl vm up
qctl new app demo --engine rootless && qctl sync
qctl vm up demo && qctl vm ps
```

**Later (Proxmox)** — keep the lab; do not `--force` init:

```bash
qctl new profile pve
qctl vm up --profile pve
qctl sync --profile pve && qctl vm up demo --profile pve
```

```bash
qctl --help
qctl vm --help
qctl new --help
```

## Commands

### `qctl init [dir]`

Create an instance (default: `.`). TTY default is **Quickstart** (profile `lab` →
workstation / `dev`). Choose Custom for the full interview, or pass `--yes` for the
lab preset with no prompts.

| Option | Default | Description |
|--------|---------|-------------|
| `[dir]` | `.` | Target directory |
| `-y` / `--yes` | `false` | Non-interactive Quickstart preset |
| `--force` | `false` | Overwrite existing scaffold files |
| `--fix` | `false` | Ensure missing layout only |
| `--check` | `false` | Validate only |
| `--dry-run` | `false` | Print plan without writing |

On an **existing** instance (TTY, no `--force`), init offers additive choices
(Add Proxmox profile / Add env / Fix layout) instead of refusing.

Writes `mise.toml`, root `package.json` (plugin deps for varlock `# @plugin`;
qctl installs `node_modules`), root `.env.schema` / `.env.dev` / `.env.prod`,
`provision/.env.schema` + `.env.dev` / `.env.prod` (Tier-0 / provision `!env`
bindings), `provision/` YAML, and empty `applications/` / `common/` /
`networks/` trees. An existing `mise.toml` is left alone unless `--force`.
Generate and commit `package-lock.json` with a local non-production ensure/load
before CI or production (frozen installs require the lockfile).

### `qctl sync`

Wait until the profile VM accepts SSH, then push the instance working tree
(`ssh2` SFTP + exec). Env/target come from the selected provision **profile** (see
[docs/provision.md](../../docs/provision.md)). On timeout: `qctl vm up`, then retry.

| Option | Default | Description |
|--------|---------|-------------|
| `-p` / `--profile` | (default profile) | Provision profile key (`qctl.profiles`) |
| `--network` | `user` | `user`/`auto`: `127.0.0.1` + `ssh.forward`; `default`: DHCP lease |
| `--user` | `rocky` | SSH admin user |
| `--host` / `--port` | (derived) | Override endpoint (required for proxmox-target profiles) |
| `--remote-dir` | `/tank/rocky` | Guest repo path |
| `--identity` | `~/.ssh/id_*` / agent | Private key |
| `--ssh-timeout` | `180` | Seconds to wait for SSH before syncing |
| `--include-tooling` | `false` | Also install `qctl-guest` → `/usr/local/bin/qctl` and `qctl-platform-rocky.mjs` → `/usr/local/lib/qctl/` (plus `varlock-local-encrypt` when present) |
| `--delete` | `true` | Remove guest files absent from this checkout (`--no-delete` to overlay only) |
| `--dry-run` | `false` | Print plan only |

Pushes the working tree and, by default, deletes guest files missing locally
(rsync `--delete` semantics). Never uploads/deletes under `.hg`, `.git`,
`node_modules`, `build.env`, editor dirs, `volumes/`, `restic-repo/`. A stray
repo-root `.env` on the guest is removed (use `.env.dev` / `.env.prod` only).
`--include-tooling` uses checkout `dist/` when the host runs from a qctl repo,
otherwise the GitHub release (`QCTL_GUEST_DIST` / `QCTL_PLATFORM_MODULE` override).
Replaces the old instance `scripts/sync-to-local.sh`.

```bash
qctl sync
qctl sync --include-tooling
qctl sync -p prod --host 10.0.0.50   # proxmox-target profile needs --host
```

### `qctl local …` (advanced)

Podman lab **without** a VM (not the Quickstart path). Requires host **Podman**.
Resolves the instance root from the current directory. Profile must have
`target: workstation`.

The outer container uses explicit `--uidmap`/`--gidmap` that split the rootless
host id budget: a dense low range for systemd/tooling (provision `users.apps.uid`/`gid`,
default 900 → your user; optional `users.apps.username`, default `apps`), and the
remaining ids mapped onto provision `users.apps.subuid` / `subgid` (`start:count`,
count ≤ 32768; default `<uid|gid>×1000:32768`) so in-appliance `/etc/subuid` +
`/etc/subgid` match the real env. Files under `volumes/` written by apps show up as your UID.
`users` / `users.admin` / `users.apps` are all optional (admin defaults to `admin`/1000).
Outer `-p` publishes every `networking.ports` entry that has a `forward`, except
`ssh` and `cockpit` (host port = `forward`, container port = `dnat` or `forward`).
App `PublishPort=` values come from each app’s `.env.schema` graph so they match
those ports.

Guest tooling (`qctl-guest` + platform module) is resolved like
`qctl sync --include-tooling` (env → local `dist/` → GitHub release).

| Subcommand | Description |
|------------|-------------|
| `qctl local up [app…]` | Ensure the appliance; optionally `quadlet up` listed apps (`--all` = every app) |
| `qctl local test <app…>` | Disposable `-test-<id>` appliance: up → healthy → tear down (Ctrl+C/error safe; no host `-p`) |
| `qctl local down [app…]` | Stop listed apps or all; remove the appliance when nothing is left running |
| `qctl local shell` | Interactive shell in the appliance |
| `qctl local ps [app…]` | Appliance status + `quadlet ps` |
| `qctl local logs [app…]` | Journals / container logs (`-f` follows one app unit) |

Shared: `-p` / `--profile` (default profile from `common.yaml`). Image override:
`QCTL_LOCAL_IMAGE` (default `quay.io/podman/stable:latest`). Extra outer run args:
`QCTL_LOCAL_PODMAN_RUN_ARGS`. When `CI` is set, the outer appliance omits
`--uidmap`/`--gidmap` so nested rootful CI can create dummy VLAN parents
(`ip link add … type dummy`); local rootless keeps the maps.

```bash
qctl local up
qctl local up -p lab caddy
qctl local up --all
qctl local test caddy
qctl local ps
qctl local down
```

### `qctl new …`

Grow the instance (apps, units, env, profile). Bare `qctl new` on a TTY opens a
kind picker. Positionals are optional on TTY (prompted / selected).

| Subcommand | Description |
|------------|-------------|
| `qctl new app [name]` | `applications/<name>/` (+ optional `app.yaml` / units) |
| `qctl new unit [app] [name]` | Unit under an existing app |
| `qctl new env [name]` | Provision environment (`env-*.yaml` + `.env.<name>`) |
| `qctl new profile [name]` | VM profile (e.g. Proxmox; keep lab, do not `--force` init) |
| `qctl new common [name]` | `common/<name>/` |
| `qctl new network [name]` | `networks/<name>/` (+ Quadlet stub) |

Most accept `--force` / `--yes`.

### `qctl vm …`

VM lifecycle against the instance `provision/` tree. Env/target come from the
selected provision **profile**. Most subcommands share:

| Option | Default | Description |
|--------|---------|-------------|
| `-p` / `--profile` | (default profile) | Provision profile key (`qctl.profiles`) |
| `--name` | (derived) | VM / domain name |
| `--connect` | `qemu:///system` | libvirt URI (workstation-target profiles) |
| `--dry-run` | `false` | Print actions without changing the host/guest |

Boot-oriented commands (`up`, `init-tank`) also accept `--memory` / `--vcpus`.
Port forwards come from `provision.networking.ports` (no CLI port overrides).
`init-tank` does not publish guest SSH/cockpit.

#### Local-target profile host deps

Libvirt VMs always get an **emulated TPM 2.0** (`virt-install --tpm` on create;
reconcile adds it to existing domains). That needs **`swtpm`** on the host PATH
alongside `virsh`, `virt-install`, and `qemu-img`.

```bash
# CachyOS / Arch example
sudo pacman -S qemu-base virt-install libvirt dnsmasq swtpm
qctl vm target-check -p default   # fails if swtpm (or other tools) missing
```

`qctl vm up` / `init-tank` also refuse to start when `swtpm` is missing.
Proxmox VMs use PVE `tpmstate0` instead — no host `swtpm` required there.

| Subcommand | Description |
|------------|-------------|
| `qctl vm seed` | Build NoCloud ISO in-process (embeds guest binaries; no host ISO tools) |
| `qctl vm download` | Download/cache the pinned Rocky 9 cloud image |
| `qctl vm up [apps…]` | Start/create VM; with apps/`--all`, wait for SSH then guest `quadlet up` |
| `qctl vm down [apps…]` | Bare: ACPI shut down VM; with apps/`--all`: guest `quadlet down` only |
| `qctl vm destroy` | Delete the VM (and disks unless `--keep-persistent`) |
| `qctl vm init-tank [poolId…]` | One-shot tank prep on a disposable boot disk (keeps `disks.os`); bare = all tanks |
| `qctl vm status` | Show VM status + SSH hints |
| `qctl vm ps [apps…]` | VM power state + guest `quadlet ps` (mirror of `local ps`) |
| `qctl vm ssh-info` | Print SSH connection hints |
| `qctl vm shell` | Interactive SSH into the VM (same endpoint as sync; Proxmox needs `--host`) |
| `qctl vm target-check` | Verify host tools (incl. `swtpm` on workstation) / provision / hypervisor |

#### `qctl vm seed`

| Option | Default | Description |
|--------|---------|-------------|
| `-p` / `--profile` | (default profile) | Provision profile (env + target layers) |
| `--seed-profile` | `appliance` | Seed ISO kind: `appliance` = full first-boot; `init-tank` = tank-create |
| `--out` | (none) | Keep unpacked cidata tree (debug; default stages in tmp) |
| `--instance-id` | reuse previous / `rocky-<env>` | cloud-init instance-id (change to force full re-run) |
| `--allow-missing-tier0` | `false` | Allow omitting Tier-0 `@tag(guest)` VW_* keys when absent |
| `--allow-missing-files` | `false` | Stub missing `!file` paths instead of failing |

#### `qctl vm up`

| Option | Default | Description |
|--------|---------|-------------|
| `[apps…]` / `--all` | (none) | After VM ready: guest `qctl quadlet up` for those apps (or every `applications/*/app.yaml`) |
| `--wipe-os` | `false` | Recreate OS overlay (keep `/vw` + tank vdevs) |
| `--force-download` | `false` | Re-download cloud image even if cached |
| `--timeout` | `2700` | Seconds to wait for boot ready |
| `--ssh-timeout` | `180` | Seconds to wait for SSH before guest quadlet (apps/`--all` only) |
| `--no-console` | `false` | Do not stream serial / wait for boot |
| `--host` / `--port` / `--user` | (endpoint) | SSH overrides for guest quadlet (Proxmox needs `--host`) |

#### `qctl vm down`

| Option | Default | Description |
|--------|---------|-------------|
| `[apps…]` / `--all` | (none) | Guest `quadlet down` only (VM stays up). Omit apps → ACPI shut down the VM |
| `--timeout` | `120` | Seconds to wait for shut off after ACPI (bare down) |
| `--force` | `false` | Force poweroff if still running after timeout (bare down) |
| `--ssh-timeout` | `60` | Seconds to wait for SSH before guest quadlet (apps/`--all` only) |

#### `qctl vm destroy`

| Option | Default | Description |
|--------|---------|-------------|
| `--keep-persistent` | `false` | Remove OS only; keep `disks.data` + tank members |
| `-y` / `--yes` | `false` | Skip prompts (only valid with `--keep-persistent`) |

### `qctl seed-kit path|export` (advanced)

Expose the Rocky seed kit ([`seed/`](./seed/) — cloud-init / first-boot / lib)
owned by this package and embedded into `qctl-host` for `qctl vm seed`. `path`
prints a host-readable root; `export` copies the kit to a directory.

## Provision

- **Profiles** — declare in `provision/common.yaml`; select with `-p` / `--profile`
- **Layers** — `common.yaml` → `target-*.yaml` → `env-*.yaml` → `profile-*.yaml` (at least one)
- **Secrets** — `!env` from `provision/.env.<env>` (+ optional `.env.local`)
- **Platform** — `qctl.platform` (`rocky` or `github:owner/repo[@x.y.z]`)

Full field reference: [docs/provision.md](../../docs/provision.md). Repo layout:
[docs/instance.md](../../docs/instance.md).

## Develop

```bash
bun run --filter @qctl/host start -- --help
bun run --filter @qctl/host start -- seed-kit path
bun run --filter @qctl/host start -- vm --help
```

Compiled as `dist/qctl-host` (`bin/qctl` for sibling checkouts).
