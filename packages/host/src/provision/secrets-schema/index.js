/**
 * Zod schemas for provision/<env>.yaml (+ optional <env>.<target>.yaml).
 * Named collections (ports, uplinks, vlans, proxmox.net) are maps keyed by name.
 */
export {
  HG_HGRC_DEFAULT,
  HG_HGRC_PATH,
  applyVcsFileDefaults,
  normalizeFiles,
} from './files.js'
export {
  appsIdentityFromProvision,
  firstBootCredentialsFromProvision,
} from './first-boot.js'
export {
  HG_PIPX_DEFAULT,
  applyVcsPackageDefaults,
  normalizePackages,
} from './packages.js'
export { parsePorts, parseSecretsFile } from './parse.js'
