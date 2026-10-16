import { z } from 'zod'

import { optionalTrimmedText } from './zod-utils.js'

/** Max subordinate count for apps subuid/subgid (nested / local map budget). */
export const MAX_APPS_SUBID_COUNT = 32768
export const DEFAULT_APPS_UID = 900
export const DEFAULT_APPS_USERNAME = 'apps'
export const DEFAULT_ADMIN_UID = 1000
export const DEFAULT_ADMIN_USERNAME = 'admin'

const optionalTrimmed = optionalTrimmedText

/** YAML number (not a quoted string). Omit the key instead of blank. */
const posixId = z.number().int().nonnegative()

const RESERVED_USERNAMES = new Set(['root', 'nobody', 'dbus'])

/** Short POSIX name; rejects root/nobody/dbus/`systemd-*`. */
export const usernameSchema = optionalTrimmed.pipe(
  z
    .string()
    .regex(/^[a-z_][a-z0-9_-]{0,31}$/i, 'username must be a short POSIX name')
    .refine((u) => !RESERVED_USERNAMES.has(u) && !u.startsWith('systemd-'), {
      message: 'username is reserved',
    }),
)

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
 * `start:count` → `{ start, count }`. Count in 1…32768.
 * Optional at the field: `subuidSchema.optional()` (omit the key; blank rejected).
 */
export const subuidSchema = z
  .string()
  .trim()
  .regex(/^\d+:\d+$/, 'must be start:count (e.g. 900000:32768)')
  .transform((s) => {
    const [start, count] = s.split(':')
    // Intermediate strings before coerce.number in the following pipe.
    return /** @type {{ start: unknown, count: unknown }} */ ({ start, count })
  })
  .pipe(
    z.strictObject({
      start: z.coerce.number().int().nonnegative(),
      count: z.coerce.number().int().min(1).max(MAX_APPS_SUBID_COUNT),
    }),
  )

/** @typedef {{ start: number, count: number }} SubuidRange */

/** `{ username }` — admin default. */
const adminUsernameSchema = z
  .strictObject({
    username: usernameSchema.default(DEFAULT_ADMIN_USERNAME),
  })
  .prefault({})

/** `{ username }` — apps default. */
const appsUsernameSchema = z
  .strictObject({
    username: usernameSchema.default(DEFAULT_APPS_USERNAME),
  })
  .prefault({})

/** `{ uid, gid }` — admin uid default; gid follows uid when omitted. */
const adminUidGidSchema = z
  .strictObject({
    uid: posixId.default(DEFAULT_ADMIN_UID),
    gid: posixId.optional(),
  })
  .prefault({})
  .transform((a) => ({ ...a, gid: a.gid ?? a.uid }))

/** `{ uid, gid }` — apps uid default; gid follows uid when omitted. */
const appsUidGidSchema = z
  .strictObject({
    uid: posixId.default(DEFAULT_APPS_UID),
    gid: posixId.optional(),
  })
  .prefault({})
  .transform((a) => ({ ...a, gid: a.gid ?? a.uid }))

const adminPasswordSchema = z.strictObject({ password: optionalTrimmed }).prefault({})

const appsSubidFieldsSchema = z
  .strictObject({
    subuid: subuidSchema.optional(),
    subgid: subuidSchema.optional(),
  })
  .prefault({})

/**
 * Appliance admin (optional). Defaults: username `admin`, uid 1000, gid→uid.
 * Password omitted → guest key-only sudo (seed SSH keys / host fallback pubkey).
 */
export const adminUserSchema = adminUsernameSchema
  .and(adminUidGidSchema)
  .and(adminPasswordSchema)
  .prefault({})

/**
 * Apps service account. Optional; defaults: username `apps`, uid 900, gid→uid,
 * subuid/subgid → `<id>×1000:32768`.
 */
export const appsUserSchema = appsUsernameSchema
  .and(appsUidGidSchema)
  .and(appsSubidFieldsSchema)
  .transform((a) => ({
    ...a,
    subuid: a.subuid ?? defaultAppsSubidRange(a.uid),
    subgid: a.subgid ?? defaultAppsSubidRange(a.gid),
  }))
  .prefault({})

/** Full `users:` block; omit → default admin + apps. */
export const usersSchema = z
  .strictObject({
    admin: adminUserSchema,
    apps: appsUserSchema,
  })
  .refine((u) => u.admin.username !== u.apps.username, {
    message: 'users.admin.username and users.apps.username must differ',
    path: ['apps', 'username'],
  })
  .prefault({})

/**
 * `start:count` string for env / docs.
 * @param {{ start: number, count: number }} range
 * @returns {string}
 */
export function formatSubuid(range) {
  return `${range.start}:${range.count}`
}
