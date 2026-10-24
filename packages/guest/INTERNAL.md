# Guest internal commands

First-boot / debug / plugin tooling on the appliance `qctl` binary. Hidden from
default `qctl -h`; listed by `qctl --help-with-internals`. Day-2 operators normally
use only [`README.md`](./README.md) (`quadlet`, `secret`).

All of these are prefixed `_internal_` so they are hard to confuse with host
`qctl init` (instance scaffold) or day-2 commands.

```bash
qctl --help-with-internals
qctl _internal_init --help
qctl _internal_list
qctl _internal_stage tier0-seal
qctl _internal_plugins ensure --help
```

## `qctl _internal_init`

Run ordered first-boot stages until the ready stamp. Invoked by systemd on first
boot (before the instance repo may exist). Dynamically `import()`s the staged
platform module to install capability packages, then runs stages in-process.

| Option | Default | Description |
|--------|---------|-------------|
| `--profile` | `default` | `default` = appliance first boot; `init-tank` = tank prep VM |
| `--dry-run` | `false` | Run every stage with `--dry-run` (print only) |
| `--from` | — | Resume at this stage (inclusive) after a failure |

Platform module: `$QCTL_PLATFORM_MODULE` → sole `qctl-platform-*.mjs` under
`/usr/local/lib/qctl` → beside this binary.

Seed units:

- `rocky-first-boot.service` → `qctl _internal_init`
- `rocky-init-tank-prep.service` → `qctl _internal_init --profile init-tank`

## `qctl _internal_list` / `qctl _internal_stage`

List or run a single init stage (debugging). Prefer
`qctl _internal_init --from <stage>` for ordered resume after a failure.

`_internal_stage` remounts cidata and loads `qctl-seed/` when available (same as
init); otherwise it uses `/etc/qctl/config.json` only (disk/ports stages need the
ISO seed).

Tier-0 seal runs as the `tier0-seal` stage inside `_internal_init` (ISO
`qctl-seed/tier0/*` → `/var/lib/qctl/tier0-pending` → `/etc/credstore.encrypted`).
The stage is idempotent.

## `qctl _internal_plugins ensure`

Install the instance `package.json` production dependencies into `node_modules`
(in-process Arborist, `omit=dev` — no npm CLI). Varlock resolves `# @plugin`
packages from `node_modules` (not plugins-cache). Graph loads reify once on
varlock’s unresolved-plugin error.

| Option | Default | Description |
|--------|---------|-------------|
| `--dir` | `/etc/qctl/config.json` `root` | Directory used to locate `package.json` |

Guest installs are always **frozen**: require a committed `package-lock.json` and
do not rewrite it. Generate/update the lockfile on the host with a non-frozen
install (`CI` unset and a non-production env), then commit it.

```bash
qctl _internal_plugins ensure
qctl _internal_plugins ensure --dir /tank/rocky
```

## Develop

```bash
bun run --filter @qctl/guest start -- _internal_list
bun test packages/guest
```
