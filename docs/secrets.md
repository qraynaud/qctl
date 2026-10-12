Provision topology (`tank`, `users`, `networking`, overlays) → [provision.md](./provision.md).

Two different paths — do not mix them:

| Path | Where keys live | How values arrive | Used for |
|------|-----------------|-------------------|----------|
| **Host provision env** | `provision/.env.schema` + `.env.<QCTL_ENV>` | Host resolves `vw()` / literals at seed | Values for `!env` in YAML |
| **Provision YAML** | `provision/<env>.yaml` (`tank`, `users`, `repo`, …) | `!env` → seed Tier-0 pending | First-boot secrets on the guest |
| **Podman secrets** | `@sensitive` on **unit** schemas | `qctl secret sync` | App container `Secret=` |

Lab vs prod is whatever the active `QCTL_ENV` graphs declare (literals in
`provision/.env.dev`, `vw()` + plugin in `provision/.env.prod`).

CLI: [packages/guest/README.md](../packages/guest/README.md).  
Plugin: [packages/vaultwarden-plugin/README.md](../packages/vaultwarden-plugin/README.md).

## First-boot (seed → Tier-0)

1. Host loads `provision/.env.<env>` (optional `.env.local`) and resolves `vw()` /
   literals there. **`.env` key names are yours** — name them however you like.
2. `provision/<env>.yaml` wires topology slots with `!env` to those keys, e.g.
   `tank.passphrase: !env MY_TANK_PASS`, `repo.deploy_key: !env …`.
3. `qctl vm seed` takes the **resolved YAML values** and maps them to the fixed
   guest credential names stages expect.
4. Guest stages read `$CREDENTIALS_DIRECTORY` / hydrated `ctx.env` — **no guest
   bootstrap graph**.

Offline reinstall: seed while Vaultwarden is reachable, then `vm up --wipe-os`
(seed runs **before** demoting the old VM).

Legacy root `.env.host` is still loaded if `provision/.env.schema` is absent.

## Day-2 Podman secrets

Unchanged: unit `@sensitive` → `qctl secret sync` → Podman secrets.
