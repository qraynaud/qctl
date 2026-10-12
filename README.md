# qctl

Host and guest CLI for appliance instances: scaffold a repo, provision a VM, run first-boot
init, manage Quadlets, and sync secrets via [varlock](https://varlock.dev).

An **instance** repo (apps, networks, schemas, `provision/*.yaml`) is separate from this
tooling. **qctl** is what you install on the workstation; the guest gets its own binaries
from the VM seed.

## Getting started

You need [mise](https://mise.jdx.dev/) and a published [qctl release](https://github.com/qraynaud/qctl/releases).

1. Create an empty repository and `cd` into it.

2. Add this `mise.toml`:

```toml
[tools]
"github:qraynaud/qctl" = { version = "latest", asset_pattern = "qctl-host", bin = "qctl" }
```

3. Install and activate:

```bash
mise install
# ensure `qctl` is on PATH (mise activate, direnv, or `mise exec -- …`)
qctl --help
```

4. Scaffold the instance:

```bash
qctl init .
```

That writes schemas, `provision/`, `applications/` / `networks/` stubs, and a matching
`mise.toml` (existing `mise.toml` is left alone unless you pass `--force`).

Edit `provision/<env>.yaml` (and optional `provision/<env>.local.yaml` /
`provision/<env>.proxmox.yaml` overlays) for networking, users, tank, and hypervisor
sizing — see [docs/provision.md](docs/provision.md) for every field and commented samples.

## CLI reference

| Role | Binary | Docs |
|------|--------|------|
| Workstation | `qctl-host` → `qctl` | [packages/host/README.md](packages/host/README.md) — `init`, `new`, `vm …` |
| Appliance | `qctl-guest` → `/usr/local/bin/qctl` | [packages/guest/README.md](packages/guest/README.md) — `init`, `quadlet …`, `secret …` |

## Docs

| Doc | What |
|-----|------|
| [packages/host/README.md](packages/host/README.md) | Host CLI reference |
| [packages/guest/README.md](packages/guest/README.md) | Guest CLI reference |
| [docs/instance.md](docs/instance.md) | Instance layout, schemas, provision, seed |
| [docs/provision.md](docs/provision.md) | Provision YAML fields, overlays, commented samples |
| [docs/secrets.md](docs/secrets.md) | `@sensitive` → Podman; `@tag(guest)` credentials |
| [packages/vaultwarden-plugin/README.md](packages/vaultwarden-plugin/README.md) | `vw()` / `@initVw` varlock plugin |

## Packages

| Package | Role |
|---------|------|
| [`@qctl/host`](packages/host/) | [Workstation CLI](packages/host/README.md) |
| [`@qctl/guest`](packages/guest/) | [Appliance CLI](packages/guest/README.md) |
| [`@qctl/platform-rocky`](packages/platform-rocky/) | Thin Rocky package map (ESM) |
| [`@qctl/shared`](packages/shared/) | Shared helpers + varlock graph API |
| [`@qctl/vaultwarden-plugin`](packages/vaultwarden-plugin/) | Vaultwarden plugin for varlock (npm) |

## Contributing

Requires [mise](https://mise.jdx.dev/) (installs Bun):

```bash
git clone https://github.com/qraynaud/qctl.git
cd qctl
mise install
bun install
bun run test:lint
bun run typecheck
bun test
bun run qctl:host -- --help
bun run qctl:guest -- --help
```

Compile linux binaries:

```bash
bun run compile
./dist/qctl-host --help
./dist/qctl-guest --help
./dist/qctl-guest list
test -f ./dist/qctl-platform-rocky.mjs
```

Point a sibling instance at this checkout with `_.path = ["{{config_root}}/../qctl/bin"]`
in that repo’s `mise.toml`.

### CI / release

- **PRs / `main`:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — version check, typecheck, tests, compile, smoke `--help`. On `main`, the job summary says whether `v$version` is ready to publish (skips proposing when that release already exists).
- **Binaries:** [`.github/workflows/release.yml`](.github/workflows/release.yml) — manual workflow with confirmation checkboxes; refuses if `v$version` already exists; re-runs CI on the commit; publishes GitHub release notes with a commit-subject changelog plus assets (`qctl-host`, `qctl-guest`, `qctl-platform-rocky.mjs`, `SHA256SUMS`). `varlock-local-encrypt` is embedded in the host/guest binaries.
- **Plugin:** [`.github/workflows/release-plugin.yml`](.github/workflows/release-plugin.yml) — `npm stage publish` `@qctl/vaultwarden-plugin` (own version; OIDC trusted publishing). Maintainer approves with 2FA (`npm stage approve` or npmjs.com → Staged Packages).

Binary version SoT: root `package.json` ↔ `QCTL_VERSION` in `@qctl/shared`.  
Plugin version SoT: `packages/vaultwarden-plugin/package.json` only.

npm trusted publisher (one-time) for `@qctl/vaultwarden-plugin`: GitHub Actions → repo
`qraynaud/qctl` → workflow **`release-plugin.yml`** → prefer **stage-only** (so CI cannot
`npm publish` directly). After the workflow stages a version, approve locally:
`npm stage approve @qctl/vaultwarden-plugin@<version>`.
