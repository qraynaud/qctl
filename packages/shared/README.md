# `@qctl/shared`

Shared library for host and guest `qctl`: instance paths, provision YAML loading,
and the **varlock graph API** (`loadEnvGraphForDir`, sensitive/non-sensitive helpers).

The `varlock` npm package is a dependency here and is compiled into both binaries —
there is no separate `varlock` CLI to install.

CLIs use **yargs** with a static `registerCommands()` registry (same module shape as
rocky’s old `commandDir`: `command` / `describe` / `builder` / `handler`). Filesystem
`commandDir` is avoided so `bun build --compile` can see every command module.

## Exports

See `src/index.js`. High-signal modules:

| Module | Role |
|--------|------|
| `varlock/` | `internal.loadEnvGraph` wrapper + resolve helpers |
| provision helpers | Parse `provision/<env>.yaml`; `!env` via `loadHostEnv` (`provision/.env.*`) |
| path / instance root | `findInstanceRoot`, `isInstanceRoot`, shared constants |
| `yargs.js` | `registerCommands` for host / guest / platform |

### Graph API

`loadEnvGraphForDir(dir, opts)` is the only resolver used by host and guest. It wraps
`internal.loadEnvGraph` with `entryFilePaths: [dir]`, `currentEnvFallback`, and
registers CLI builtins (`varlock()`, `keychain()`) that raw `loadEnvGraph` omits.
Before load it ensures the nearest `package.json` has `node_modules` installed
(Arborist — no npm CLI); varlock resolves `# @plugin` packages from there.
Installs are frozen (`package-lock.json` required, not rewritten) when `CI=true`
or `QCTL_ENV` is not `dev`.

| Export | Meaning |
|--------|---------|
| `loadEnvGraphForDir(dir, { env, qctlEnv, skipSensitive, extraEntryPaths })` | Load + resolve; throws on schema/item errors. `qctlEnv` → `QCTL_ENV` + autoload; `skipSensitive` skips `@sensitive` resolve. Resolves non-`vw()` first so interactive prompts do not race |
| `resolvedNonSensitive(graph, { includeInternal })` | `Record<string,string>`; `@internal` only with `includeInternal` (Quadlet `${VAR}`); `@sensitive` never |
| `resolvedSensitive(graph)` | `{ key, value }[]` sorted by key |
| `hydrateSystemdCredentials` | Fill unset keys from `$CREDENTIALS_DIRECTORY` (pairs with `@tag(guest)`) |

- `@internal` items are excluded from exports by default; Quadlet render uses
  `includeInternal: true` but still drops `@sensitive`.
- “Sensitive” means an explicit `@sensitive` / secret resolver — varlock’s global
  “everything is sensitive” default is ignored for qctl’s `isSensitiveItem`.

## Docs

- [Instance layout](../../docs/instance.md) — schemas, hub, provision
- [Secrets](../../docs/secrets.md) — `@sensitive` → Podman; `@tag(guest)` → credentials
