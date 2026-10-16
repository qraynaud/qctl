/**
 * Zod schemas for provision YAML (common + <env> + optional <env>.<target>).
 * Named collections (ports, uplinks, vlans, proxmox.net) stay maps keyed by name.
 * Disks helpers: import from `./disks.js` / `./resolve-disks.js` / `@qctl/shared` directly.
 */
export { collectDisksWarnings } from './disks.js'
export {
  appsIdentityFromProvision,
  firstBootCredentialsFromProvision,
} from './first-boot.js'
export { alignProxmoxNets, portsSchema } from './networking.js'
export { parseProvisionOrThrow, provisionSchema } from './parse.js'
