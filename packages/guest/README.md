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

Generate and manage Quadlet units from the instance repo. Run as the admin user
(or root); no `sudo` needed.

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

Cross-app deps use `other.service` in unit templates (same-engine or
rootful↔rootless). After a qctl upgrade, run `qctl quadlet up` once.
Details: [docs/instance.md](../../docs/instance.md).

### `qctl secret …`

Resolve unit-schema `@sensitive` values through the varlock graph and compare or write
Podman secrets. Run as the admin user (or root); no `sudo` needed.

| Option | Description |
|--------|-------------|
| `--env` | Override env label for schema `@import` |
| `--app` | Limit to one app (and shared secrets it uses) |

| Subcommand | Description |
|------------|-------------|
| `check` | Compare graph values to Podman secrets; exit 1 on drift |
| `sync` | Create/replace Podman secrets from the graph (skip unchanged) |

#### `qctl secret sync`

| Option | Default | Description |
|--------|---------|-------------|
| `--dry-run` | `false` | Print actions only |
| `--restart` | `false` | Restart apps whose secrets changed |
| `--app` | — | One app only; use this in `ExecStartPre` |

```bash
qctl secret check
qctl secret sync
qctl secret sync --restart
qctl secret sync --app=caddy
```

After vault changes: `check` then `sync --restart`. Before a unit starts:
`ExecStartPre=qctl secret sync --app=<name>`. See [docs/secrets.md](../../docs/secrets.md).

## Develop

```bash
bun run --filter @qctl/guest start -- quadlet --help
bun test packages/guest
```
