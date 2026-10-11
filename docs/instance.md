# Instance layout

How an **instance** repo is laid out for qctl (what `qctl init` / `qctl new` scaffold,
and what host/guest CLIs expect).

For command flags see [packages/host/README.md](../packages/host/README.md) and
[packages/guest/README.md](../packages/guest/README.md). Secrets → [secrets.md](./secrets.md).

## Roles

| Artifact | Role | On PATH / install |
|----------|------|-------------------|
| `qctl-host` | Workstation: `init`, `new`, `sync`, `vm`, `seed-kit` | mise → `qctl` |
| `qctl-guest` | Appliance: `init` stages, `quadlet`, `secret` | seed → `/usr/local/bin/qctl` |
| `qctl-platform-rocky.mjs` | Thin Rocky package map + install | `/usr/local/lib/qctl/` (guest `import()`) |
| `@qctl/vaultwarden-plugin` | `vw()` / `@initVw` for varlock | npm `# @plugin(…)` pin |

**Varlock is not a separate install.** The `varlock` package is a dependency of
`@qctl/shared` and is compiled into host and guest. Schemas load only through the
**graph API** — never the `varlock` CLI.

## Tree

```text
.env.schema                          # root graph (imports .env.dev / .env.prod by QCTL_ENV)
.env.dev / .env.prod                 # non-secret root values (# @internal in schema)
.env.host [/ .env.host.local]        # host provision secrets for !env (not scaffolded)
applications/                          # package schemas @import repo root
  <app>/.env.schema                  # package / Quadlet ${VAR} template scope
  <app>/.env.app                     # optional package values
  <app>/.env.<app>                   # optional package values
  <app>/<unit>/.env.schema           # unit graph → EnvironmentFile=.env + @sensitive
  <app>/<unit>/.env.<env>            # unit values (autoload via currentEnvFallback)
common/<lib>/.env.schema             # shared libs (secret sync discovers these too)
networks/
  <net>/.env.schema + <net>.network
provision/<env>.yaml                 # topology + qctl.platform + !env
provision/<env>.<target>.yaml        # optional overlay (local / proxmox)
mise.toml                            # host: pin qctl-host (or _.path to sibling bin)
# caches: ~/.cache/qctl/{images,tooling,repos/<hash>/seed}
#          ~/.local/share/qctl/repos/<hash>/vms
```

`qctl init` writes the root schemas, provision stubs, and empty
`applications/` / `common/` / `networks/` trees. `qctl new app|common|network`
adds a package `.env.schema` + README.

## Schemas

- Prefer **schemas** over committed secret manifests. Mark secrets `@sensitive`.
- Directory graphs use `currentEnvFallback` so `.env.<env>` beside the schema
  autoloads (root and units). Do **not** also `# @import` that same file from the
  directory’s `.env.schema` (duplicates `@initVw` / values).
- Package / unit schemas `# @import(../../)` / `# @import(../../../)` the **repo
  root** (shared `.env.dev` / `.env.prod`). Optional: pin `@qctl/vaultwarden-plugin`
  + `@initVw(…)` on root `.env.prod` — see [secrets.md](./secrets.md) and
  [packages/vaultwarden-plugin/README.md](../packages/vaultwarden-plugin/README.md).
- Package-root graphs are for Quadlet `${VAR}` render. Do **not** assign
  `@sensitive` keys there — put secrets in the unit folder (`Secret=`).
- Value files use varlock syntax (literals, `${OTHER}` refs). Bash
  `${X:-default}` is wrong.
- `QCTL_ENV` = `--env`, else `$QCTL_ENV`, else `ENV=` in the repo `.env` link, else `dev`.

| File | Role |
|------|------|
| `.env.dev` / `.env.prod` (repo root) | Shared non-secrets (optional prod `@plugin` / `@initVw`); `# @internal` in root schema |
| `.env.host` | Host-only provision secrets (`!env`); optional `vw()` |
| `.env.host.local` | Machine-local overlay of `.env.host` (gitignored) |
| `applications/<app>/.env.schema` | Template scope (`# @import(../../)`) |
| `applications/<app>/<unit>/.env.schema` | Unit → installed `EnvironmentFile=.env` + secrets (`# @import(../../../)`) |

## Provision YAML

```yaml
qctl:
  platform: rocky                          # or github:owner/repo[@x.y.z]
# networking, disks, … — secret fields use !env
```

Host/guest binaries follow the running `qctl` (mise). `qctl.platform` selects
which platform adapter module to seed/import; its release tag defaults to the
host version. Varlock plugins are **not** provision pins — declare them in
schemas with `# @plugin(@pkg@version)`.

- Committable: `provision/<env>.yaml` (+ `provision/<env>.<target>.yaml` overlays).
- Host resolves `!env` via `loadHostEnv` (bundled graph API over `.env.host`, then
  optional `.env.host.local`) — no `varlock` CLI.
- VM/seed/image caches: XDG (`~/.cache/qctl`, `~/.local/share/qctl`), not in-repo.

## mise (host only)

```toml
[tools]
"github:qraynaud/qctl" = { version = "latest", asset_pattern = "qctl-host", bin = "qctl" }
```

Dev sibling checkout instead of the GitHub pin:

```toml
[env]
_.path = ["{{config_root}}/../qctl/bin"]
```

The qctl repo exposes `bin/qctl` (compiled `dist/qctl-host` or bun fallback).
Guest never installs mise.

## Seed

`qctl vm seed` stages `qctl-guest`, `qctl-platform-rocky.mjs`, and
`varlock-local-encrypt` from checkout `dist/` when the host runs from a qctl repo,
otherwise from the GitHub release (host/`qctl.platform` version). Override with
`QCTL_GUEST_DIST`. First-boot secrets come from provision → Tier-0 pending.
Install renames `qctl-guest` → `/usr/local/bin/qctl`. No separate `varlock` binary.

## Guest: Quadlet

`qctl quadlet {up,down,enable,start,stop,restart,ps}` manages units from the instance
repo. Appliance install also drops `/usr/local/bin/quadlet` → `qctl quadlet`
(default `QCTL_ROOT=/tank/rocky`) plus bash-completion.

Instance root is `--root` / `$QCTL_ROOT` (validated), else walk-up from `cwd`.
Mutating commands re-exec with `sudo -n`. Rootless apps install under the `apps`
user’s `~/.config/containers/systemd`; rootful under `/etc/containers/systemd`.

Package-root graph → Quadlet `${VAR}` render. Unit graph → `EnvironmentFile=.env`
and Podman secrets ([secrets.md](./secrets.md)).

## Guest: first boot

`qctl init [--profile default|init-tank]` is the only first-boot entrypoint (systemd
invokes it before the instance repo may exist). Stages live in `@qctl/guest`; the
platform module only supplies package recipes. Details:
[packages/guest/README.md](../packages/guest/README.md).
