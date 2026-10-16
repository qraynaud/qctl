Provision topology (`tank`, `users`, `networking`, overlays) → [provision.md](./provision.md).

Two different paths — do not mix them:

| Path | Where keys live | How values arrive | Used for |
|------|-----------------|-------------------|----------|
| **Host provision env** | `provision/.env.schema` + `.env.<QCTL_ENV>` | Host resolves `vw()` / literals at seed | Values for `!env` in YAML |
| **Provision YAML** | `provision/<env>.yaml` (`tank`, `users`, `repo`, …) | `!env` → seed Tier-0 pending | First-boot secrets on the guest |
| **Podman secrets** | `@sensitive` on **unit** schemas | `qctl secret sync` | App container `Secret=` |

Lab vs prod (or any custom env) is whatever the active `QCTL_ENV` graphs declare
(literals in `provision/.env.dev`, `vw()` + plugin in `provision/.env.prod`, …).
Host commands set `QCTL_ENV` from the selected provision **profile**’s `env`
(`qctl … --profile` / `-p`).

### Varlock plugins (`# @plugin`)

1. List the package (with version) in the instance root `package.json`
   `dependencies` — that is the version SoT (plus `package-lock.json`).
2. Reference it in env-spec **without** a version: `# @plugin(@scope/name)`.
3. Let qctl install `node_modules` (Arborist — no npm CLI) when a graph load hits
   varlock’s unresolved-plugin error (one reify + retry), or via
   `qctl _internal_plugins ensure`.

Do **not** rely on varlock’s plugins-cache. Commit `package-lock.json` after a
local non-production (`production: false`) install. Installs are **frozen**
(lockfile required, not rewritten) when `CI=true` **or** the active env is marked
`production: true` in `qctl.environments` (see [provision.md](./provision.md)).
Non-production custom envs (e.g. `staging`) stay mutable unless CI.

CLI: [packages/guest/README.md](../packages/guest/README.md)
([INTERNAL.md](../packages/guest/INTERNAL.md) for `_internal_plugins`).  
Plugin: [packages/vaultwarden-plugin/README.md](../packages/vaultwarden-plugin/README.md).

## First-boot (seed → Tier-0)

1. Host loads `provision/.env.<env>` (optional `.env.local`) and resolves `vw()` /
   literals there. **`.env` key names are yours** — name them however you like.
2. `provision/<env>.yaml` wires topology slots with `!env` to those keys, e.g.
   `tank.passphrase: !env MY_TANK_PASS`, or
   `repo.deploy_key: !env { name: DEPLOY_KEY, encoding: base64 }` when the host
   value is transport-encoded (CI cannot hold `\n`).
3. `qctl vm seed` takes the **resolved YAML values** (`Buffer` from `!env`) and
   maps them to the fixed guest credential names stages expect.
4. Guest stages read `$CREDENTIALS_DIRECTORY` / hydrated `ctx.env` — **no guest
   bootstrap graph**.

Offline reinstall: seed while Vaultwarden is reachable, then `vm up --wipe-os`
(seed runs **before** demoting the old VM).

## Day-2 Podman secrets

Unchanged: unit `@sensitive` → `qctl secret sync` → Podman secrets.
