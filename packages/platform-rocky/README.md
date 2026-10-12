# `@qctl/platform-rocky`

Rocky Linux platform adapter staged onto the guest as `qctl-platform-rocky.mjs`:

- capability → distro recipe map + `installPackages(string[])`
- `networking` — NetworkManager egress + firewalld DNAT (guest init stages call these)
- `cloud-image.json` / `CLOUD_IMAGE` — pinned Rocky GenericCloud qcow2; host dynamically imports `CLOUD_IMAGE` from `qctl-platform-rocky.mjs` (not embedded in `qctl-host`, not a separate `dist/cloud-image.json`)

NoCloud / first-boot seed kit lives in [`@qctl/host` `seed/`](../host/seed/).

Guest dynamically `import()`s the module under `/usr/local/lib/qctl/`. Init stage
*orchestration* lives in `@qctl/guest`; OS-specific networking apply lives here.

```js
import { platform } from '@qctl/platform-rocky'

await platform.installPackages(['curl', 'jq', 'zfs'])
await platform.networking.ensureUp(ctx)
```

Pipx / http installs stay in provision `packages:` (seed `install-packages.sh`).

## Develop

```bash
bun test packages/platform-rocky
bun run compile   # emits dist/qctl-platform-rocky.mjs
```
