/**
 * Zod schemas for provision YAML (common → target-* → env-* → profile-*).
 * Named collections (ports, interfaces) stay maps keyed by name/label.
 * Disks helpers: import from `./disks.js` / `./resolve-disks.js` / `@qctl/shared` directly.
 */
export { collectDisksWarnings } from './disks.js'
export {
  appsIdentityFromProvision,
  firstBootCredentialsFromProvision,
} from './first-boot.js'
export { alignedVmNics, dummyInterfaceNames, portsSchema } from './networking.js'
export { parseProvisionOrThrow, provisionSchema } from './parse.js'
