# `@qctl/host`

Workstation **host** CLI — shipped as the `qctl-host` release asset and installed as
`qctl` on PATH (via mise).

Scaffold an instance repo, then drive the appliance VM from `provision/*.yaml`.

```bash
qctl --help
qctl local --help
qctl vm --help
qctl seed-kit path
```

## Commands

### `qctl seed-kit path|export`

Expose the Rocky seed kit ([`seed/`](./seed/) — cloud-init / first-boot / lib)
owned by this package and embedded into `qctl-host` for `qctl vm seed`. `path`
prints a host-readable root; `export` copies the kit to a directory.

### `qctl init [dir]`

Scaffold a new instance repository (default: `.`).

| Option | Default | Description |
|--------|---------|-------------|
| `[dir]` | `.` | Target directory |
| `--force` | `false` | Overwrite existing scaffold files |

Writes `mise.toml`, root `.env.schema` / `.env.dev` / `.env.prod`,
`provision/.env.schema` + `.env.dev` / `.env.prod` (Tier-0 / provision `!env`
bindings), `provision/` YAML stubs, and empty `applications/` / `common/` /
`networks/` trees. An existing `mise.toml` is left alone unless `--force`.

### `qctl sync`

Push the current instance working tree to the appliance over SSH (`ssh2` SFTP +
exec). Defaults match other host commands (`--env dev`, `--target local`).

| Option | Default | Description |
|--------|---------|-------------|
| `--target` | `local` | `local` = libvirt passt/DHCP; `proxmox` needs `--host` |
| `--env` | `dev` | Selects `provision/<env>.yaml` (+ overlay) for ports / name |
| `--network` | `user` | `user`/`auto`: `127.0.0.1` + `ssh.forward`; `default`: DHCP lease |
| `--user` | `rocky` | SSH admin user |
| `--host` / `--port` | (derived) | Override endpoint (required for Proxmox) |
| `--remote-dir` | `/tank/rocky` | Guest repo path |
| `--identity` | `~/.ssh/id_*` / agent | Private key |
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
qctl sync --target proxmox --host 10.0.0.50
```

### `qctl local …`

Run Quadlets in a nested systemd+Podman appliance on the workstation (no VM).
Requires host **Podman**. Resolves the instance root from the current directory.

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

Shared: `--env` (default `dev`). Image override: `QCTL_LOCAL_IMAGE` (default
`quay.io/podman/stable:latest`). Extra outer run args: `QCTL_LOCAL_PODMAN_RUN_ARGS`.

```bash
qctl local up
qctl local up caddy
qctl local up --all
qctl local test caddy
qctl local ps
qctl local down
```

### `qctl new …`

Add package stubs under the instance root.

| Subcommand | Description |
|------------|-------------|
| `qctl new app <name>` | `applications/<name>/` |
| `qctl new common <name>` | `common/<name>/` |
| `qctl new network <name>` | `networks/<name>/` |

Each accepts `--force` to overwrite existing schema/README files.

### `qctl vm …`

VM lifecycle against the instance `provision/` tree. Most subcommands share:

| Option | Default | Description |
|--------|---------|-------------|
| `--target` | `local` | `local` = libvirt; `proxmox` = PVE API |
| `--env` | `dev` | Selects `provision/<env>.yaml` (+ overlay) and related defaults |
| `--name` | (derived) | VM / domain name |
| `--connect` | `qemu:///system` | libvirt URI (`local` only) |
| `--dry-run` | `false` | Print actions without changing the host/guest |

Boot-oriented commands (`up`, `init-tank`) also accept `--memory` / `--vcpus`.
`vm up` (and `status` / `ssh-info`) expose passt `--*-port` overrides from provision
networking; `init-tank` does not (no guest SSH/cockpit).

| Subcommand | Description |
|------------|-------------|
| `qctl vm seed` | Build NoCloud ISO in-process (embeds guest binaries; no host ISO tools) |
| `qctl vm download` | Download/cache the pinned Rocky 9 cloud image |
| `qctl vm up` | Start existing VM, or create if missing; stream console until ready |
| `qctl vm down` | ACPI shutdown; wait until shut off (VM stays defined) |
| `qctl vm destroy` | Undefine / delete VM; delete disks unless `--keep-data` |
| `qctl vm init-tank` | One-shot tank prep VM (minimal seed → create/export → poweroff) |
| `qctl vm status` | Show VM status + SSH hints |
| `qctl vm ssh-info` | Print SSH connection hints |
| `qctl vm target-check` | Verify host tools / secrets / hypervisor for `--target` |

#### `qctl vm seed`

| Option | Default | Description |
|--------|---------|-------------|
| `--profile` | `appliance` | `appliance` = full first-boot; `init-tank` = tank-create seed |
| `--out` | (none) | Keep unpacked cidata tree (debug; default stages in tmp) |
| `--instance-id` | reuse previous / `rocky-<env>` | cloud-init instance-id (change to force full re-run) |
| `--allow-missing-tier0` | `false` | Allow omitting Tier-0 `@tag(guest)` VW_* keys when absent |
| `--allow-missing-files` | `false` | Stub missing `!file` paths instead of failing |

#### `qctl vm up`

| Option | Default | Description |
|--------|---------|-------------|
| `--wipe-os` | `false` | Recreate OS overlay (keep `/vw` + tank vdevs) |
| `--force-download` | `false` | Re-download cloud image even if cached |
| `--timeout` | `2700` | Seconds to wait for boot ready |
| `--no-console` | `false` | Do not stream serial / wait for boot |

#### `qctl vm down`

| Option | Default | Description |
|--------|---------|-------------|
| `--timeout` | `120` | Seconds to wait for shut off after ACPI |
| `--force` | `false` | Force poweroff if still running after timeout |

#### `qctl vm destroy`

| Option | Default | Description |
|--------|---------|-------------|
| `--keep-data` | `false` | Remove OS only; keep `/vw` + data + special disks |

## Provision

Topology and secrets wiring live in the instance:

- `provision/<env>.yaml` (+ `provision/<env>.<target>.yaml` overlay)
- `!env` fields resolve from `provision/.env.<env>` (+ optional `.env.local`) via the bundled varlock graph API
- Tier-0 credentials: `# @tag(guest)` keys on provision env (seeded into `/var/lib/rocky/tier0-pending/<KEY>`)
- Platform selection: `qctl.platform` (`rocky` or `github:owner/repo[@x.y.z]`)

See [docs/instance.md](../../docs/instance.md).

## Develop

```bash
bun run --filter @qctl/host start -- --help
bun run --filter @qctl/host start -- seed-kit path
bun run --filter @qctl/host start -- vm --help
```

Compiled as `dist/qctl-host` (`bin/qctl` for sibling checkouts).
