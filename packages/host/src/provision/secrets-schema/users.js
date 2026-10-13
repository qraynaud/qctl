import { z } from 'zod'

import { optionalTrimmedText } from './zod-utils.js'

/** @import { RefinementCtx } from 'zod' */

/** Max subordinate count for apps subuid/subgid (nested / local map budget). */
export const MAX_APPS_SUBID_COUNT = 32768
export const DEFAULT_APPS_UID = 900
export const DEFAULT_APPS_USERNAME = 'apps'
export const DEFAULT_ADMIN_UID = 1000
export const DEFAULT_ADMIN_USERNAME = 'admin'

const optionalTrimmed = optionalTrimmedText

const uidGid = z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((v, ctx) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isInteger(n) || n < 0) {
    ctx.addIssue({ code: 'custom', message: 'must be a non-negative integer' })
    return z.NEVER
  }
  return n
})

/**
 * Default subordinate range: `<id> × 1000 : MAX_APPS_SUBID_COUNT`
 * (ids above ~100 stay clear of the dense low userns used by local nested maps).
 * @param {number} id apps uid or gid
 * @returns {{ start: number, count: number }}
 */
export function defaultAppsSubidRange(id) {
  const n = Number(id)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`apps id for subid default must be an integer >= 1 (got ${id})`)
  }
  return { start: n * 1000, count: MAX_APPS_SUBID_COUNT }
}

/**
 * uid/gid resolution: gid defaults to uid when gid omitted; uid may have a default.
 * Setting only gid keeps uid at `defaultUid`.
 * @param {number | null | undefined} uid
 * @param {number | null | undefined} gid
 * @param {number | null} defaultUid
 * @returns {{ uid: number | null, gid: number | null }}
 */
export function resolveUidGid(uid, gid, defaultUid = null) {
  const resolvedUid = uid ?? defaultUid
  const resolvedGid = gid ?? resolvedUid
  return { uid: resolvedUid, gid: resolvedGid }
}

/**
 * @param {string} username
 * @param {RefinementCtx} ctx
 * @param {string[]} [extraReserved]
 * @returns {boolean}
 */
function assertPosixUsername(username, ctx, extraReserved = []) {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(username)) {
    ctx.addIssue({
      code: 'custom',
      message: 'username must be a short POSIX name',
      path: ['username'],
    })
    return false
  }
  const reserved = new Set(['root', 'nobody', 'dbus', ...extraReserved])
  if (reserved.has(username) || username.startsWith('systemd-')) {
    ctx.addIssue({
      code: 'custom',
      message: `username ${JSON.stringify(username)} is reserved`,
      path: ['username'],
    })
    return false
  }
  return true
}

/**
 * Optional `start:count` → `{ start, count }` or `null` when omitted.
 * Count must be in 1…32768.
 */
export const subuidSchema = z.union([z.string(), z.null(), z.undefined()]).transform((raw, ctx) => {
  if (raw == null || String(raw).trim() === '') return null
  const t = String(raw).trim()
  const m = /^(\d+):(\d+)$/.exec(t)
  if (!m) {
    ctx.addIssue({
      code: 'custom',
      message: 'must be start:count (e.g. 900000:32768)',
    })
    return z.NEVER
  }
  const start = Number(m[1])
  const count = Number(m[2])
  if (!Number.isInteger(start) || start < 0) {
    ctx.addIssue({ code: 'custom', message: 'start must be a non-negative integer' })
    return z.NEVER
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_APPS_SUBID_COUNT) {
    ctx.addIssue({
      code: 'custom',
      message: `count must be an integer in 1…${MAX_APPS_SUBID_COUNT}`,
    })
    return z.NEVER
  }
  return { start, count }
})

/** @typedef {{ start: number, count: number }} SubuidRange */

/**
 * Appliance admin (optional). Defaults: username `admin`, uid 1000, gid→uid.
 * Password omitted → guest key-only sudo (seed SSH keys / host fallback pubkey).
 */
export const adminUserSchema = z
  .object({
    username: optionalTrimmed.optional(),
    password: optionalTrimmed.optional(),
    uid: uidGid.optional(),
    gid: uidGid.optional(),
  })
  .passthrough()
  .transform((a, ctx) => {
    const username = a.username ?? DEFAULT_ADMIN_USERNAME
    if (!assertPosixUsername(username, ctx, [DEFAULT_APPS_USERNAME])) return z.NEVER
    const { uid, gid } = resolveUidGid(a.uid, a.gid, DEFAULT_ADMIN_UID)
    return {
      ...a,
      username,
      uid: /** @type {number} */ (uid),
      gid: /** @type {number} */ (gid),
    }
  })

/**
 * Apps service account. Optional; defaults: username `apps`, uid 900, gid→uid,
 * subuid/subgid → `<id>×1000:32768`.
 */
export const appsUserSchema = z
  .object({
    username: optionalTrimmed.optional(),
    uid: uidGid.optional(),
    gid: uidGid.optional(),
    subuid: subuidSchema.optional(),
    subgid: subuidSchema.optional(),
  })
  .passthrough()
  .transform((a, ctx) => {
    const username = a.username ?? DEFAULT_APPS_USERNAME
    if (!assertPosixUsername(username, ctx, [DEFAULT_ADMIN_USERNAME])) return z.NEVER
    const { uid, gid } = resolveUidGid(a.uid, a.gid, DEFAULT_APPS_UID)
    const resolvedUid = /** @type {number} */ (uid)
    const resolvedGid = /** @type {number} */ (gid)
    return {
      ...a,
      username,
      uid: resolvedUid,
      gid: resolvedGid,
      subuid: a.subuid ?? defaultAppsSubidRange(resolvedUid),
      subgid: a.subgid ?? defaultAppsSubidRange(resolvedGid),
    }
  })

export const usersSchema = z
  .object({
    // preprocess so `{}` / omit still run username+uid defaults (zod `.default({})` skips parse)
    admin: z.preprocess((v) => (v == null ? {} : v), adminUserSchema),
    apps: z.preprocess((v) => (v == null ? {} : v), appsUserSchema),
  })
  .passthrough()
  .superRefine((u, ctx) => {
    if (u.admin.username === u.apps.username) {
      ctx.addIssue({
        code: 'custom',
        message: `users.admin.username and users.apps.username both ${JSON.stringify(u.admin.username)}`,
        path: ['apps', 'username'],
      })
    }
  })

/**
 * `start:count` string for env / docs.
 * @param {{ start: number, count: number }} range
 * @returns {string}
 */
export function formatSubuid(range) {
  return `${range.start}:${range.count}`
}
