# Writing a thin VM driver

A driver is a **hypervisor adapter**: define / power / destroy the guest, map
provision overlays, and bind a flag store. Product flows (`vm up`, init-tank,
wipe-os, download, INSTALLED) stay in shared host runners.

## Checklist

1. **Id** — `export const id = vmDriverIdSchema.parse('your-target')`.
2. **Register** — build a `VmDriverModule` / `VmDriverRegistration` and call
   `registerDriver(module)` (side-effect import from `drivers/index.js` or your
   entry).
3. **Provision overlay** — Zod schema on `provisionOverlaySchema` (same object
   exported for typed parse). Optional `refineProvision(data, ctx)` for
   cross-field checks (wired via `provisionSchema` `superRefine`).
4. **Scaffold** — optional `scaffoldHint` (picker text) and
   `scaffoldTargetYaml()` (stub for `provision/target-<id>.yaml`). Prefer a
   Nunjucks file at `templates/provision/target-<id>.yaml.njk` when shipping
   with host; the module stub is the fallback for third-party drivers.
5. **Thin ops** — implement `find` / `create` / `start` / `stop` /
   `destroy(ctx, { keepDisks })` / `reconcile` / `detachSeed` /
   `collectCheckFacts` / `createFlagStore` / `powerState` / `resolveEndpoint` /
   `getStatus` / `defaultVmName`.
   `create(ctx, specs: VmSpecs)` takes the full guest shape; `reconcile` takes
   `Partial<VmSpecs>` (patch — only listed fields change). Disks are labeled
   (no os/tank/data roles) — see [`driver-contract.ts`](../driver-contract.ts).
6. **Do not** copy `runVmUp` / init-tank / down / destroy / check / status
   orchestration — commands call shared runners with `{ module, ctx }` from
   `resolveDriver`.

## Init / new

Target pickers and `target-*.yaml` stubs come from the registry
([`scaffold.js`](./scaffold.js)): `listScaffoldTargets()`,
`resolveTargetYamlStub(id)`. Interactive overlay wizards for builtins still
live under `init/wizard/overlays.js`; a third target can start with a stub
YAML and fill overlays manually until a wizard exists.

## Smoke test

```js
import { registerDriver, listDriverIds, getDriverModule } from './registry.js'
import { resolveTargetYamlStub } from './scaffold.js'

registerDriver(yourModule)
expect(listDriverIds().map(String)).toContain(String(yourModule.id))
expect(getDriverModule(yourModule.id)?.provisionOverlaySchema).toBeTruthy()
expect(resolveTargetYamlStub(yourModule.id)).toMatch(new RegExp(`^${yourModule.id}:`, 'm'))
```
