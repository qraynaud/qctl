import { z } from 'zod'

/** @import { YamlMapping } from '@qctl/shared' */

const optionalTrimmed = z.union([z.string(), z.null(), z.undefined()]).transform((v) => {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
})

/**
 * Tank passphrase (required for init-tank / tank-import when creating or reseeding the key file).
 */
export const tankSchema = z
  .object({
    passphrase: optionalTrimmed.optional(),
  })
  .passthrough()
  .optional()

/**
 * Admin user for the appliance (optional → key-only default "rocky").
 */
export const adminSchema = z
  .object({
    username: optionalTrimmed.optional(),
    password: optionalTrimmed.optional(),
    uid: optionalTrimmed.optional(),
    gid: optionalTrimmed.optional(),
  })
  .passthrough()
  .optional()

/**
 * Registry login lines: `registry|username|token` (same shape as former @tag(container-registry)).
 */
export const registriesSchema = z.array(z.string()).optional()

/**
 * Fixed Tier-0 / env credential names stages read after seed (host-resolved).
 * @typedef {object} FirstBootCredentials
 * @property {string} [TANK_PASSPHRASE]
 * @property {string} [DEPLOY_KEY]
 * @property {string} [ADMIN_USERNAME]
 * @property {string} [ADMIN_PASSWORD]
 * @property {string} [ADMIN_UID]
 * @property {string} [ADMIN_GID]
 * @property {string} [SSH_HOST_KEYS]
 * @property {string} [ROCKY_REGISTRIES] JSON array of registry|user|token
 */

/**
 * Map resolved provision YAML → fixed guest credential names for Tier-0 pending.
 *
 * @param {YamlMapping} data parsed+resolved provision root
 * @returns {FirstBootCredentials}
 */
export function firstBootCredentialsFromProvision(data) {
  /** @type {FirstBootCredentials} */
  const out = {}
  const tank =
    data.tank && typeof data.tank === 'object' && !Array.isArray(data.tank)
      ? /** @type {YamlMapping} */ (data.tank)
      : null
  const admin =
    data.admin && typeof data.admin === 'object' && !Array.isArray(data.admin)
      ? /** @type {YamlMapping} */ (data.admin)
      : null
  const repo =
    data.repo && typeof data.repo === 'object' && !Array.isArray(data.repo)
      ? /** @type {YamlMapping} */ (data.repo)
      : null
  const ssh =
    data.ssh && typeof data.ssh === 'object' && !Array.isArray(data.ssh)
      ? /** @type {YamlMapping} */ (data.ssh)
      : null

  const pass = tank?.passphrase != null ? String(tank.passphrase).trim() : ''
  if (pass) out.TANK_PASSPHRASE = pass

  const deploy = repo?.deploy_key != null ? String(repo.deploy_key).trim() : ''
  if (deploy) out.DEPLOY_KEY = deploy

  const user = admin?.username != null ? String(admin.username).trim() : ''
  if (user) out.ADMIN_USERNAME = user
  const pw = admin?.password != null ? String(admin.password).trim() : ''
  if (pw) out.ADMIN_PASSWORD = pw
  const uid = admin?.uid != null ? String(admin.uid).trim() : ''
  if (uid) out.ADMIN_UID = uid
  const gid = admin?.gid != null ? String(admin.gid).trim() : ''
  if (gid) out.ADMIN_GID = gid

  const hostKeys = ssh?.host_keys != null ? String(ssh.host_keys).trim() : ''
  if (hostKeys) out.SSH_HOST_KEYS = hostKeys

  if (Array.isArray(data.registries)) {
    const regs = data.registries.map((r) => String(r ?? '').trim()).filter(Boolean)
    if (regs.length) out.ROCKY_REGISTRIES = JSON.stringify(regs)
  }

  return out
}
