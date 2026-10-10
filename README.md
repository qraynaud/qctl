# qctl

Bun-based appliance tooling: host CLI (scaffold + VM), guest CLI (init / quadlet / secrets), and platform adapters.

**rocky** (and similar repos) stay as *instance* trees — apps, networks, varlock schemas, provision YAML. This repo ships the reusable engines.

## Packages

| Package | Purpose |
|---------|---------|
| `@qctl/shared` | Shared types, paths, platform protocol |
| `@qctl/host` | Host `qctl`: `init`, `new`, `vm` |
| `@qctl/guest` | Guest `qctl`: `init`, `quadlet`, `secret` |
| `@qctl/platform-rocky` | Rocky Linux init stages |

See [docs/conventions.md](docs/conventions.md) for varlock schema and provision conventions.

## Develop

Requires [mise](https://mise.jdx.dev/) (installs Bun):

```bash
mise install
bun install
bun run qctl:host -- --help
bun run qctl:guest -- --help
```

Compile linux binaries locally:

```bash
bun run compile
./dist/qctl-host --help
./dist/qctl --help
./dist/qctl-platform-rocky list
```

## Status

Phase 0 scaffold — command trees and compile/CI stubs only. Implementation tracks the extract plan in the rocky instance repo.
