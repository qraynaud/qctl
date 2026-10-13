# `@qctl/vaultwarden-plugin`

[Varlock](https://varlock.dev) plugin for **Vaultwarden** / Bitwarden Password Manager via the official [`bw`](https://bitwarden.com/help/cli/) CLI.

```env
# @plugin(@qctl/vaultwarden-plugin)
# @initVw(sessionToken=$BW_SESSION, cacheTtl=5m)
# @initVw(id=work, appDataDir=/vw-work, sessionToken=$BW_SESSION_WORK)
# ---
# @type=vwSession
BW_SESSION=

DB_PASSWORD=vw("Production DB")
API_TOKEN=vw("My App", field="api-token")
TLS_KEY=vw("My App", attachment="tls.key", encoding=base64)
WORK_SECRET=vw("work", "Work Item", field="password")
```

## Why not `@varlock/bitwarden-plugin`?

The official [`@varlock/bitwarden-plugin`](https://www.npmjs.com/package/@varlock/bitwarden-plugin) covers two products:

| Official API | Product | Access |
|--------------|---------|--------|
| `@initBitwarden` + `bitwarden()` | Bitwarden **Secrets Manager** | REST + machine-account token |
| `@initBwp` + `bwp()` | Password Manager / Vaultwarden | `bw` CLI |

This package is an alternative to the official **Password Manager** path (`@initBwp` / `bwp`). Prefer the official plugin when it fits; use this one when you need the extras below.

| | Official `@initBwp` / `bwp` | This plugin `@initVw` / `vw` |
|--|----------------------------|-----------------------------|
| Item password (default) | `bwp("Item")` | `vw("Item")` |
| Built-in fields | username, notes, totp, uri, … | via `field=` (incl. custom fields) |
| Custom fields | yes | yes — `field="name"` |
| **Attachments** | no | yes — `attachment="file.ext"` (+ `encoding=`) |
| API-key login (Path B) | limited / different shape | `clientId` + `clientSecret` + `masterPassword` (+ optional `serverUrl`) |
| Session type | `bwSessionToken` / `BWP_SESSION` | `vwSession` / typically `BW_SESSION` |
| Value cache | `cacheTtl` on `@initBwp` | `cacheTtl` on `@initVw` |
| Session cache TTL | `sessionTtl` | `sessionTtl` |

It does **not** implement Secrets Manager (`bitwarden()`). For that, use the official plugin.

## Install

Version SoT is the instance `package.json` / lockfile. Add the dependency (qctl
installs `node_modules` via Arborist — no npm CLI):

```json
{
  "dependencies": {
    "@qctl/vaultwarden-plugin": "0.1.5"
  }
}
```

Reference it in env-spec **without** an `@version` pin:

```env
# @plugin(@qctl/vaultwarden-plugin)
```

Varlock prefers `node_modules` over its plugins-cache. Do not rely on cache-only
installs. Commit `package-lock.json` after a local `QCTL_ENV=dev` ensure/load —
CI and non-`dev` envs use a **frozen** lockfile install.

**Prerequisite:** `bw` on `PATH` for the process that resolves the graph.

## Schema setup

Initialize once in a file that other schemas import:

```env
# @plugin(@qctl/vaultwarden-plugin)
# @initVw(
#   appDataDir=/vw,
#   serverUrl=https://vw.example.com/,
#   clientId=$VW_CLIENT_ID,
#   clientSecret=$VW_CLIENT_SECRET,
#   masterPassword=$VW_MASTER_PASSWORD,
#   cacheTtl=5m
# )
# ---
# @type=vwSession
BW_SESSION=

# @internal @sensitive
VW_CLIENT_ID=
# @internal @sensitive
VW_CLIENT_SECRET=
# @internal @sensitive
VW_MASTER_PASSWORD=
```

Interactive unlock uses `bw unlock --raw` (TTY; session cached) — same idea as bare `@initBwp()`. For non-interactive use, pass `sessionToken=` and/or `clientId` / `clientSecret` / `masterPassword`.

## `@initVw(…)`

Named arguments only. Repeatable for multiple accounts: omit `id=` once for the
**default** account; use distinct `id=` values for additional vaults.
`id=` must be a static literal (`id=perso` or `id="perso"`, not `$VAR`) so the
plugin can key clients at schema process time.

Auth mode is chosen by which you set (`sessionToken`, interactive unlock, or
`clientId`+`clientSecret`+`masterPassword`). `clientId` and `clientSecret` must
both be set or both omitted.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `id` | `string` | no | Account name for multi-vault schemas; omit for the default account |
| `appDataDir` | `string` | no† | `bw` data directory (`BITWARDENCLI_APPDATA_DIR`). Leading `~` / `~/…` expands to `$HOME` |
| `sessionToken` | `string` | no | Pre-obtained session (`bw unlock --raw`), often `$BW_SESSION` |
| `masterPassword` | `string` | no | Unlock / login password |
| `serverUrl` | `string` | no | Vaultwarden / Bitwarden server URL |
| `clientId` | `string` | no‡ | API key id (`bw login --apikey`); pair with `clientSecret` |
| `clientSecret` | `string` | no‡ | API key secret; pair with `clientId` |
| `sessionTtl` | `string` \| `number` | no | Cached session lifetime (`forever`, `1h`, …, or ms) |
| `cacheTtl` | `string` \| `number` | no | Resolved `vw()` value cache TTL (`5m`, …, or ms) |
| `syncTtl` | `string` \| `number` | no | Skip `bw sync` when `bw status.lastSync` is newer (default `5m`). `forever` disables sync |
| `bin` | `string` | no | Path to `bw` if not on `PATH` |

†Required when `id=` is set. ‡Required together when using API-key login.

## `vw(…)`

```env
# Default account — item password (default field)
SECRET=vw("Item Name")

# Default account — built-in or custom field
USER=vw("Item Name", field="username")
TOKEN=vw("Item Name", field="api-token")

# Named account (`@initVw(id=work, …)`) — two positionals: id, item
WORK=vw("work", "Item Name", field="password")

# Attachment (optional encoding: utf8 | base64)
KEY=vw("Item Name", attachment="id_ed25519", encoding=utf8)
BLOB=vw("work", "Item Name", attachment="bundle.tar.gz", encoding=base64)
```

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| account id (positional) | `string` | no | When **two** positionals are given, the first is the `@initVw(id=…)` name |
| item (positional) | `string` | yes | Vault item name (or id). Alone → default account; as 2nd arg → with account id |
| `field` | `string` | no | Item field to read; default `password` (named only) |
| `attachment` | `string` | no | Attachment filename on the item (mutually exclusive with `field`) |
| `encoding` | `"utf8"` \| `"base64"` | no | Attachment payload encoding; only valid with `attachment=` (default `utf8`) |

Do not combine `field=` and `attachment=` on the same call.
With one positional, that argument is always the item (default account).
With two positionals, they are `(accountId, item)` — use `field=` / `attachment=` for the rest.

## `vwSession`

Data type for a CLI session token (output of `bw unlock --raw`). Defaults to `@sensitive` + `@internal`, like the official `bwSessionToken`.

## Package notes

Published entry is `exports["./plugin"]` → a self-contained CJS build (`varlock` / `varlock/plugin-lib` stay external; varlock supplies them at load time).

```bash
bun run build    # → dist/vaultwarden.cjs
bun test
```

Release: after merge to `main`, workflow `release.yml` re-runs checks; approve the
**release-plugin** environment when that version is not yet on npm, then it runs
`npm stage publish` (OIDC trusted publisher = **`release.yml`**). Then approve with 2FA:

```bash
npm stage approve @qctl/vaultwarden-plugin@$(node -p "require('./package.json').version")
```

## See also

- Official Bitwarden plugin docs: https://varlock.dev/plugins/bitwarden/
- Varlock plugins guide: https://varlock.dev/guides/plugins/
