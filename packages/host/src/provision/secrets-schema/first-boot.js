import { z } from 'zod'

import { isYamlMapping } from '@qctl/shared'

import { formatSubuid } from './users.js'
import { optionalTrimmedText } from './zod-utils.js'

/** @import { YamlMapping, YamlValue } from '@qctl/shared' */
/** @import { SubuidRange } from './users.js' */

/**
 * Tank passphrase (required for init-tank / tank-import when creating or reseeding the key file).
 */
export const tankSchema = z
  .object({
    passphrase: optionalTrimmedText.optional(),
  })
  .passthrough()
  .optional()

/**
 * Registry login lines: `registry|username|token` (same shape as former @tag(container-registry)).
 */
export const registriesSchema = z.array(z.string()).optional()

/**
 * Tier-0 credential value: utf8 text or opaque bytes from `!env`.
 *
 * @typedef {string | Buffer} CredentialValue
 */

/**
 * Fixed Tier-0 / env credential names stages read after seed (host-resolved).
 * @typedef {object} FirstBootCredentials
 * @property {CredentialValue} [TANK_PASSPHRASE]
 * @property {CredentialValue} [DEPLOY_KEY]
 * @property {string} [ADMIN_USERNAME]
 * @property {CredentialValue} [ADMIN_PASSWORD]
 * @property {string} [ADMIN_UID]
 * @property {string} [ADMIN_GID]
 * @property {CredentialValue} [SSH_HOST_KEYS]
 * @property {string} [ROCKY_REGISTRIES] JSON array of registry|user|token
 */

/**
 * @param {YamlValue | undefined} value
 * @returns {string}
 */
function asText(value) {
  if (value == null) return ''
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8').trim()
  }
  return String(value).trim()
}

/**
 * Preserve byte credentials; trim string credentials.
 *
 * @param {YamlValue | undefined} value
 * @returns {CredentialValue | undefined}
 */
function asCredential(value) {
  if (value == null) return undefined
  if (Buffer.isBuffer(value)) return value.length ? value : undefined
  if (value instanceof Uint8Array) {
    return value.length ? Buffer.from(value) : undefined
  }
  if (typeof value === 'string') {
    const t = value.trim()
    return t === '' ? undefined : t
  }
  const t = String(value).trim()
  return t === '' ? undefined : t
}

/**
 * Map resolved provision YAML → fixed guest credential names for Tier-0 pending.
 * Apps identity is not Tier-0 — seed bakes it for baseline / Quadlet separately.
 *
 * @param {YamlMapping} data parsed+resolved provision root
 * @returns {FirstBootCredentials}
 */
export function firstBootCredentialsFromProvision(data) {
  /** @type {FirstBootCredentials} */
  const out = {}
  const tank = isYamlMapping(data.tank) ? data.tank : null
  const users = isYamlMapping(data.users) ? data.users : null
  const admin = isYamlMapping(users?.admin) ? users.admin : null
  const repo = isYamlMapping(data.repo) ? data.repo : null
  const ssh = isYamlMapping(data.ssh) ? data.ssh : null

  const pass = asCredential(tank?.passphrase)
  if (pass != null) out.TANK_PASSPHRASE = pass

  const deploy = asCredential(repo?.deploy_key)
  if (deploy != null) out.DEPLOY_KEY = deploy

  // Schema defaults username/uid/gid; password optional (key-only admin).
  const user = asText(admin?.username) || 'admin'
  if (user) out.ADMIN_USERNAME = user
  const pw = asCredential(admin?.password)
  if (pw != null) out.ADMIN_PASSWORD = pw
  const uid = asText(admin?.uid) || '1000'
  if (uid) out.ADMIN_UID = uid
  const gid = asText(admin?.gid) || uid
  if (gid) out.ADMIN_GID = gid

  const hostKeys = asCredential(ssh?.host_keys)
  if (hostKeys != null) out.SSH_HOST_KEYS = hostKeys

  if (Array.isArray(data.registries)) {
    const regs = data.registries.map((r) => asText(r)).filter(Boolean)
    if (regs.length) out.ROCKY_REGISTRIES = JSON.stringify(regs)
  }

  return out
}

/**
 * Normalized apps identity from parsed provision (`users.apps`).
 * @param {YamlMapping} data
 * @returns {{
 *   username: string,
 *   uid: number,
 *   gid: number,
 *   subuid: SubuidRange,
 *   subgid: SubuidRange,
 *   subuidSpec: string,
 *   subgidSpec: string,
 * } | null}
 */
export function appsIdentityFromProvision(data) {
  const users = isYamlMapping(data.users) ? data.users : null
  const apps = users?.apps
  if (!isYamlMapping(apps)) return null
  const a = /**
   * @type {{
   *   username?: string,
   *   uid?: number,
   *   gid?: number,
   *   subuid?: SubuidRange,
   *   subgid?: SubuidRange,
   * }} */ (apps)
  if (!a.subuid || typeof a.subuid !== 'object') return null
  if (!a.subgid || typeof a.subgid !== 'object') return null
  const uid = typeof a.uid === 'number' ? a.uid : 900
  const gid = typeof a.gid === 'number' ? a.gid : uid
  const username =
    typeof a.username === 'string' && a.username.trim() !== '' ? a.username.trim() : 'apps'
  return {
    username,
    uid,
    gid,
    subuid: a.subuid,
    subgid: a.subgid,
    subuidSpec: formatSubuid(a.subuid),
    subgidSpec: formatSubuid(a.subgid),
  }
}
