# `@qctl/guest`

Appliance **guest** CLI — shipped as the `qctl-guest` release asset. Seed install places
it at `/usr/local/bin/qctl` and adds `/usr/local/bin/quadlet` → `qctl quadlet`.

Owns first-boot stages, Quadlet lifecycle, varlock plugin cache, and Podman secret sync.
The thin OS adapter is a separate staged ESM module (`qctl-platform-rocky.mjs`)
with packages + networking hooks. The Rocky seed kit lives in
`@qctl/host` `seed/` (embedded into `qctl-host` for `vm seed` / `seed-kit`).

```bash
qctl --help
qctl quadlet --help
qctl secret --help
```

Default `qctl -h` / `--help` lists day-2 commands (`quadlet`, `secret`) and
mentions `--help-with-internals` in the epilogue. Bare `qctl` (no args) shows the
same public command list without that hint.

First-boot / debug / plugin tooling (`_internal_init`, `_internal_list`,
`_internal_stage`, `_internal_plugins`) is documented in
[INTERNAL.md](./INTERNAL.md) — `qctl --help-with-internals` lists those commands.

## Commands

### `qctl quadlet …`

Generate and manage Quadlet units from the instance repo. Requires root (passwordless
`sudo`); re-execs with an explicit `--root`.

Shared option:

| Option | Default | Description |
|--------|---------|-------------|
| `--root` | `$QCTL_ROOT` or walk-up | Instance root (`provision/` + `qctl:` block) |

| Subcommand | Description |
|------------|-------------|
| `up [apps…]` | Reconcile listed apps (plus companions); omit = all |
| `down <apps…>` | Stop and unregister apps (data stays) |
| `enable <apps…>` | Render/install units (`--no-install` skips autostart) |
| `start` / `stop` / `restart <apps…>` | `systemctl` for each app’s units |
| `ps [apps…]` | Container status (omit = all installed) |

```bash
qctl quadlet up
qctl quadlet up caddy active-directory
qctl quadlet ps caddy
qctl quadlet restart caddy
qctl quadlet down caddy active-directory
```

### `qctl secret …`

Resolve unit-schema `@sensitive` values through the varlock graph and compare or write
Podman secrets. Prefers root via passwordless sudo (shared plugin cache + rootful store);
without sudo, operates on the rootless store only.

Shared options:

| Option | Default | Description |
|--------|---------|-------------|
| `--root` | `$QCTL_ROOT` or walk-up | Instance root |
| `--env` | (detect) | Override guest `QCTL_ENV` for schema `@import` (host seed sets it from the provision profile) |

| Subcommand | Description |
|------------|-------------|
| `check` | Compare graph-resolved `@sensitive` values to Podman secrets (`qctl.sha256` labels); exit 1 on drift |
| `sync` | Create/replace Podman secrets from the graph (skip unchanged) |

#### `qctl secret sync`

| Option | Default | Description |
|--------|---------|-------------|
| `--dry-run` | `false` | Print actions only |
| `--restart` | `false` | Restart apps whose secrets changed (omit from `ExecStartPre`) |

Podman secret name = schema key as-is (`CADDY_DNS` → `CADDY_DNS`). Store follows each
app’s `engine:` (rootful → rootful store; else rootless). Tag `# @tag(cross-engine)` to
write into both stores. Unit schemas: `applications/<app>/<unit>/.env.schema` and
`common/<lib>/.env.schema`.

```bash
qctl secret check
qctl secret sync
qctl secret sync --restart
qctl secret check && qctl secret sync --restart
```

Day-2 after vault changes: `check` then `sync --restart`. Quadlet hook:
`ExecStartPre=qctl secret sync --root ${REPO_ROOT}`.

See [docs/secrets.md](../../docs/secrets.md).

## Develop

```bash
bun run --filter @qctl/guest start -- quadlet --help
bun test packages/guest
```
