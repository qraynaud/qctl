import { z } from 'zod'

import { tankPassphraseCredName } from '@qctl/shared'

import { DEFAULT_ADMIN_UID, DEFAULT_ADMIN_USERNAME, formatSubuid } from './users.js'
import { trimmedText } from './zod-utils.js'

export { tankPassphraseCredName }

/** @import { ProvisionFile } from './types.js' */
/** @import { SubuidRange } from './users.js' */

/**
 * Registry login lines: `registry|username|token` (same shape as former @tag(container-registry)).
 * Entries may be plain strings or `Buffer` from resolved `!env`.
 */
export const registriesSchema = z.array(trimmedText).prefault([])

/**
 * Tier-0 credential value: utf8 text or opaque bytes from `!env`.
 *
 * @typedef {string | Buffer} CredentialValue
 */

/**
 * Fixed Tier-0 / env credential names stages read after seed (host-resolved).
 * Per encrypted tank: {@link tankPassphraseCredName} → `tank_passphrase_<poolId>`.
 * @typedef {{
 *   DEPLOY_KEY?: CredentialValue,
 *   ADMIN_USERNAME?: string,
 *   ADMIN_PASSWORD?: string,
 *   ADMIN_UID?: string,
 *   ADMIN_GID?: string,
 *   SSH_HOST_KEYS?: CredentialValue,
 *   ROCKY_REGISTRIES?: string,
 *   [cred: string]: CredentialValue | undefined,
 * }} FirstBootCredentials
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
 * @param {ProvisionFile} data
 * @returns {FirstBootCredentials}
 */
export function firstBootCredentialsFromProvision(data) {
  /** @type {FirstBootCredentials} */
  const out = {}

  for (const tank of Object.values(data.disks?.tanks || {})) {
    const pass = asCredential(tank.passphrase)
    if (pass == null) continue
    out[tankPassphraseCredName(tank.id)] = pass
  }

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
 * @param {ProvisionFile} data
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

/**
 * @typedef {{ username?: string, uid?: number, gid?: number }} AdminUserStub
 */

/**
 * Non-secret admin identity from parsed provision (`users.admin`).
 * Defaults match provision schema when stubs omit admin (tests).
 * @param {ProvisionFile | { users?: { admin?: AdminUserStub } }} data
 * @returns {{ username: string, uid: number, gid: number }}
 */
export function adminIdentityFromProvision(data) {
  const a = data.users?.admin
  const uid = a?.uid ?? DEFAULT_ADMIN_UID
  return {
    username: a?.username ?? DEFAULT_ADMIN_USERNAME,
    uid,
    gid: a?.gid ?? uid,
  }
}
