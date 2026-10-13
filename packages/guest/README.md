# `@qctl/guest`

Appliance **guest** CLI — shipped as the `qctl-guest` release asset. Seed install places
it at `/usr/local/bin/qctl` and adds `/usr/local/bin/quadlet` → `qctl quadlet`.

Owns first-boot stages, Quadlet lifecycle, varlock plugin cache, and Podman secret sync.
The thin OS adapter is a separate staged ESM module (`qctl-platform-rocky.mjs`)
with packages + networking hooks. The Rocky seed kit lives in
`@qctl/host` `seed/` (embedded into `qctl-host` for `vm seed` / `seed-kit`).

```bash
qctl --help
qctl init --help
qctl plugins ensure --help
qctl quadlet --help
qctl secret --help
```

## Commands

### `qctl init`

Run ordered first-boot stages until the ready stamp. Invoked by systemd on first boot
(before the instance repo may exist). Dynamically `import()`s the staged platform module
to install capability packages, then runs stages in-process.

| Option | Default | Description |
|--------|---------|-------------|
| `--profile` | `default` | `default` = appliance first boot; `init-tank` = tank prep VM |
| `--dry-run` | `false` | Run every stage with `--dry-run` (print only) |
| `--from` | — | Resume at this stage (inclusive) after a failure |

Platform module: `$QCTL_PLATFORM_MODULE` → sole `qctl-platform-*.mjs` under
`/usr/local/lib/qctl` → beside this binary.

### `qctl list` / `qctl stage`

List or run a single init stage (debugging / resume).

### `qctl plugins ensure`

Install the instance `package.json` dependencies into `node_modules` (in-process
Arborist — no npm CLI). Varlock resolves `# @plugin` packages from `node_modules`
(not plugins-cache). Graph loads reify once on varlock’s unresolved-plugin error.

| Option | Default | Description |
|--------|---------|-------------|
| `--dir` | instance root / cwd | Directory used to locate `package.json` |

Install mode:

- **Mutable** when `QCTL_ENV=dev` and `CI` is not `true` — may create/update
  `package-lock.json`.
- **Frozen** when `CI=true` or `QCTL_ENV` is not `dev` — requires a committed
  `package-lock.json` and does not rewrite it.

```bash
qctl plugins ensure
qctl plugins ensure --dir /tank/rocky
```

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
| `--env` | (detect) | Override `QCTL_ENV` for schema `@import` |

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
bun run --filter @qctl/guest start -- list
bun test packages/guest
```
