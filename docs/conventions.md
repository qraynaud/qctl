# qctl conventions

## Roles

| Binary | Role | Typical location |
|--------|------|------------------|
| `qctl` (host build) | Workstation: `init`, `new`, `vm` | mise on PATH |
| `qctl` (guest build) | Appliance: `init`, `quadlet`, `secret` | staged in VM seed |
| `qctl-platform-rocky` | Rocky init stages | staged beside guest `qctl` |
| `varlock` | Env/secrets SoT | mise on host; staged on guest |
| `@qctl/vaultwarden-plugin` | VW session + fields/attachments | staged plugin cache |

Host and guest both ship a binary named `qctl` with **role-specific** `init`.

## Instance layout (rocky and other appliances)

```text
.env.schema                          # root composition
applications/<app>/.env.schema
common/<lib>/.env.schema
networks/<net>/.env.schema
provision/<env>.yaml                 # topology + qctl: tooling pins + !env
provision/local/                     # cache only (not committed)
mise.toml                            # tools only: qctl + varlock (host)
```

## Varlock schemas

- Prefer **schemas** over committed `.env` / secrets manifests.
- Mark secrets with `@sensitive`. Non-sensitive values feed Quadlet `EnvironmentFile=` / template subst.
- Declare plugins in schema, e.g. `@plugin(@qctl/vaultwarden-plugin@…)`.
- Vaultwarden plugin owns session lifecycle (`appDataDir`, Path A/B unlock, `bw` spawn). Resolvers: item-by-name, **custom fields**, **attachments**.

Guest `qctl` resolves via varlock’s graph API when possible; otherwise shells out to the staged `varlock` CLI with the same plugin cache.

## Provision YAML

```yaml
qctl:
  tooling:
    qctl: "v0.1.0"
    varlock: "…"
    platform: "rocky@v0.1.0"
    plugins:
      - "@qctl/vaultwarden-plugin@…"
# networking, disks, … — secret fields use !env
```

- Committable: `provision/<env>.yaml` (+ overlays).
- Not committed: `provision/local/**` (images, seed ISO, VM disks).
- Host commands that need secrets **auto-reexec under varlock**.

## mise (host only)

Instance `mise.toml` pins tools — **no required `[tasks]`**:

```toml
[tools]
qctl = "v0.1.0"
varlock = "latest"
```

Guest never installs mise. Day-2 on the appliance is `qctl` + staged varlock/plugins on `PATH`.

## Seed contents

`qctl vm seed` embeds at least: guest `qctl`, `qctl-platform-rocky`, `varlock`, `@qctl/vaultwarden-plugin`, `bw` (when VW is used), plus a **bootstrap schema** for pre-clone Vaultwarden steps.
