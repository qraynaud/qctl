# `@qctl/guest`

Appliance **guest** CLI — shipped as the `qctl-guest` release asset. Seed install places
it at `/usr/local/bin/qctl` and adds `/usr/local/bin/quadlet` → `qctl quadlet`.

Owns first-boot stages, Quadlet lifecycle, and Podman secret sync.
The thin OS adapter is a separate staged ESM module (`qctl-platform-rocky.mjs`)
with packages + networking hooks. The Rocky seed kit lives in
`@qctl/host` `seed/` (embedded into `qctl-host` for `vm seed` / `seed-kit`).

```bash
qctl --help
qctl init --help
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

Sync Podman secrets from varlock schemas.

## Develop

```bash
bun run --filter @qctl/guest start -- list
bun test packages/guest
```
