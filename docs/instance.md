# Instance layout

How an **instance** repo is laid out for qctl (what `qctl init` / `qctl new` scaffold,
and what host/guest CLIs expect).

For command flags see [packages/host/README.md](../packages/host/README.md) and
[packages/guest/README.md](../packages/guest/README.md). Provision YAML →
[provision.md](./provision.md). Secrets → [secrets.md](./secrets.md).

## Roles

| Artifact | Role | On PATH / install |
|----------|------|-------------------|
| `qctl-host` | Workstation: `init`, `new`, `sync`, `vm`, `seed-kit` | mise → `qctl` |
| `qctl-guest` | Appliance: `init` stages, `quadlet`, `secret` | seed → `/usr/local/bin/qctl` |
| `qctl-platform-rocky.mjs` | Thin Rocky package map + install | `/usr/local/lib/qctl/` (guest `import()`) |
| `@qctl/vaultwarden-plugin` | `vw()` / `@initVw` for varlock | instance `package.json` + `# @plugin(…)` |

**Varlock is not a separate install.** The `varlock` package is a dependency of
`@qctl/shared` and is compiled into host and guest. Schemas load only through the
**graph API** — never the `varlock` CLI.

## Tree

```text
package.json                         # plugin deps (qctl → node_modules); commit package-lock.json
.env.schema                          # root graph (autoload .env.<QCTL_ENV>)
.env.dev / .env.prod                 # non-secret root values (# @internal in schema)
applications/                          # package schemas @import repo root
  <app>/.env.schema                  # package / Quadlet ${VAR} template scope
  <app>/.env.app                     # optional package values
  <app>/.env.<app>                   # optional package values
  <app>/<unit>/.env.schema           # unit graph → EnvironmentFile=.env + @sensitive
  <app>/<unit>/.env.<env>            # unit values (autoload via currentEnvFallback)
common/<lib>/.env.schema             # shared libs (secret sync discovers these too)
networks/
  <net>/.env.schema + <net>.network
provision/.env.schema                # host provision graph (!env / @tag(guest))
provision/.env.<env>                 # host provision values (+ optional .env.local)
provision/common.yaml                # shared + environments / profiles
provision/target-<target>.yaml       # hypervisor defaults
provision/env-<env>.yaml             # per-env topology (!env secrets OK)
provision/profile-<profile>.yaml     # per-profile overrides (merged last)
mise.toml                            # host: pin qctl-host (or _.path to sibling bin)
# caches: ~/.cache/qctl/{images,tooling,repos/<hash>/seed}
#          ~/.local/share/qctl/repos/<hash>/vms
```

`qctl init` writes the root schemas, `package.json`, provision stubs, and empty
`applications/` / `common/` / `networks/` trees. `qctl new app|common|network`
adds a package `.env.schema` + README.

## Schemas

- Prefer **schemas** over committed secret manifests. Mark secrets `@sensitive`.
- Directory graphs use `currentEnvFallback` so `.env.<env>` beside the schema
  autoloads (root and units). Do **not** also `# @import` that same file from the
  directory’s `.env.schema` (duplicates `@initVw` / values).
- Package / unit schemas `# @import(../../)` / `# @import(../../../)` the **repo
  root** (shared `.env.dev` / `.env.prod`). Optional: pin `@qctl/vaultwarden-plugin`
  + `@initVw(…)` on root `.env.prod`, and list the same package in root
  `package.json` `dependencies` (`qctl` installs `node_modules`; commit
  `package-lock.json` for CI / production) — see [secrets.md](./secrets.md) and
  [packages/vaultwarden-plugin/README.md](../packages/vaultwarden-plugin/README.md).
- Package-root graphs are for Quadlet `${VAR}` render. Do **not** assign
  `@sensitive` keys there — put secrets in the unit folder (`Secret=`).
- Value files use varlock syntax (literals, `${OTHER}` refs). Bash
  `${X:-default}` is wrong.
- Host commands set `QCTL_ENV` from the selected **provision profile**’s `env`
  (`qctl … --profile` / `-p`). On the guest, seed bakes that value; day-2 tools
  may override with their own `--env` / detect.

| File | Role |
|------|------|
| `package.json` (+ `package-lock.json`) | Plugin deps; qctl → `node_modules` (frozen when `CI=true` or env `production: true`) |
| `.env.dev` / `.env.prod` (repo root) | Shared non-secrets (optional prod `@plugin` / `@initVw`); `# @internal` in root schema |
| `provision/.env.schema` + `.env.<env>` | Host provision secrets for `!env` / `@tag(guest)`; optional `vw()` |
| `provision/.env.local` | Machine-local overlay of provision env (gitignored) |
| `applications/<app>/.env.schema` | Template scope (`# @import(../../)`) |
| `applications/<app>/<unit>/.env.schema` | Unit → installed `EnvironmentFile=.env` + secrets (`# @import(../../../)`) |

## Provision YAML

```yaml
# provision/common.yaml
qctl:
  platform: rocky                          # or github:owner/repo[@x.y.z]
# Other layers: networking, disks, … — secrets use !env
```

Host and guest binaries match the running `qctl` (mise). `qctl.platform` picks
the guest platform module (release tag defaults to the host version). Profiles
pick env + target — see [provision.md](./provision.md). List varlock plugins in
`package.json` `dependencies` and `# @plugin(@pkg)` in schemas (no `@version` in
the decorator).

- Layers (at least one): `common.yaml`, `target-*.yaml`, `env-*.yaml`,
  `profile-*.yaml` — merge order in [provision.md](./provision.md).
- `!env` resolves from `provision/.env.schema` + `.env.<env>` (+ optional
  `.env.local`); no separate `varlock` CLI.
- Images / seed / VM disks: under `~/.cache/qctl` and `~/.local/share/qctl`, not
  in the instance repo.

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

`qctl vm seed` stages `qctl-guest` and `qctl-platform-rocky.mjs` from checkout
`dist/` when the host runs from a qctl repo, otherwise from the GitHub release.
`varlock-local-encrypt` comes from the host embed (materialized beside `qctl` at
runtime for varlock’s SEA sibling lookup — not PATH). Override guest/platform with
`QCTL_GUEST_DIST`. First-boot secrets come from provision → Tier-0 pending.
Install renames `qctl-guest` → `/usr/local/bin/qctl`.

## Guest: Quadlet

`qctl quadlet {up,down,enable,start,stop,restart,ps}` manages units from the instance
repo. Appliance install also drops `/usr/local/bin/quadlet` → `qctl quadlet`
plus bash-completion.

Instance root comes from `/etc/qctl/config.json` (written by guest load-seed from
ISO `qctl-seed/config.json`). Same resolution for `qctl secret {check,sync}`.
Mutating quadlet commands re-exec with `sudo -n`. Rootless apps install under the
`apps` user’s `~/.config/containers/systemd`; rootful under `/etc/containers/systemd`.

Package-root graph → Quadlet `${VAR}` render. Unit templates also get
`${__DIRNAME}` (absolute directory of the file being rendered). Unit graph →
`EnvironmentFile=.env` and Podman secrets ([secrets.md](./secrets.md)).

## Guest: first boot

`qctl _internal_init [--profile default|init-tank]` is the only first-boot entrypoint
(systemd invokes it before the instance repo may exist). Stages live in `@qctl/guest`;
the platform module only supplies package recipes. Details:
[packages/guest/INTERNAL.md](../packages/guest/INTERNAL.md).
