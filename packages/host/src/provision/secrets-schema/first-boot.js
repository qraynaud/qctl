import { z } from 'zod'

import { formatSubuid } from './users.js'
import { optionalTrimmedText, trimmedText } from './zod-utils.js'

/** @import { SecretsFile } from './types.js' */
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
 * Entries may be plain strings or `Buffer` from resolved `!env`.
 */
export const registriesSchema = z.array(trimmedText).optional()

/**
 * Tier-0 credential value: utf8 text or opaque bytes from `!env`.
 *
 * @typedef {string | Buffer} CredentialValue
 */

/**
 * Fixed Tier-0 / env credential names stages read after seed (host-resolved).
 * @typedef {object} FirstBootCredentials
 * @property {string} [TANK_PASSPHRASE]
 * @property {CredentialValue} [DEPLOY_KEY]
 * @property {string} [ADMIN_USERNAME]
 * @property {string} [ADMIN_PASSWORD]
 * @property {string} [ADMIN_UID]
 * @property {string} [ADMIN_GID]
 * @property {CredentialValue} [SSH_HOST_KEYS]
 * @property {string} [ROCKY_REGISTRIES] JSON array of registry|user|token
 */

/**
 * @param {CredentialValue | null | undefined} value
 * @returns {CredentialValue | undefined}
 */
function asCredential(value) {
  if (value == null) return undefined
  if (Buffer.isBuffer(value)) return value.length ? value : undefined
  const t = value.trim()
  return t === '' ? undefined : t
}

/**
 * Map parsed provision → fixed guest credential names for Tier-0 pending.
 * Apps identity is not Tier-0 — seed bakes it for baseline / Quadlet separately.
 *
 * @param {SecretsFile} data
 * @returns {FirstBootCredentials}
 */
export function firstBootCredentialsFromProvision(data) {
  /** @type {FirstBootCredentials} */
  const out = {}

  const pass = data.tank?.passphrase
  if (pass) out.TANK_PASSPHRASE = pass

  const deploy = asCredential(data.repo?.deploy_key)
  if (deploy != null) out.DEPLOY_KEY = deploy

  const admin = data.users.admin
  out.ADMIN_USERNAME = admin.username
  const pw = admin.password
  if (pw) out.ADMIN_PASSWORD = pw
  out.ADMIN_UID = String(admin.uid)
  out.ADMIN_GID = String(admin.gid)

  const hostKeys = asCredential(data.ssh?.host_keys)
  if (hostKeys != null) out.SSH_HOST_KEYS = hostKeys

  if (data.registries?.length) {
    out.ROCKY_REGISTRIES = JSON.stringify(data.registries)
  }

  return out
}

/**
 * Normalized apps identity from parsed provision (`users.apps`).
 * @param {SecretsFile} data
 * @returns {{
 *   username: string,
 *   uid: number,
 *   gid: number,
 *   subuid: SubuidRange,
 *   subgid: SubuidRange,
 *   subuidSpec: string,
 *   subgidSpec: string,
 * }}
 */
export function appsIdentityFromProvision(data) {
  const a = data.users.apps
  return {
    username: a.username,
    uid: a.uid,
    gid: a.gid,
    subuid: a.subuid,
    subgid: a.subgid,
    subuidSpec: formatSubuid(a.subuid),
    subgidSpec: formatSubuid(a.subgid),
  }
}
