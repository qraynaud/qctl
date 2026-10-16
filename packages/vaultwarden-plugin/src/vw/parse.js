/**
 * Pure Vaultwarden helpers (no varlock import) — unit-testable without `bw`.
 *
 * The varlock wiring lives in `plugin.js`.
 */
const { homedir } = require('node:os')
const { join } = require('node:path')

const { z } = require('zod')

/**
 * Expand a leading `~` / `~/…` to the current user's home directory.
 * Other tildes (`~otheruser`, mid-path) are left unchanged.
 * @param {string} path
 * @returns {string}
 */
function expandHomePath(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2))
  }
  return path
}

/**
 * Map key for `@initVw` without `id=` / `vw()` without an account id.
 * @type {symbol}
 */
const DEFAULT_VW_ACCOUNT = Symbol('vw.default')

/**
 * Account id for multi-`@initVw` (string) or the default Symbol.
 * @typedef {string | typeof DEFAULT_VW_ACCOUNT} VwAccountId
 */

/**
 * Resolved `vw()` call shape after string resolution.
 * @typedef {{
 *   kind: 'field',
 *   item: string,
 *   field: string,
 *   accountId: VwAccountId,
 * } | {
 *   kind: 'attachment',
 *   item: string,
 *   file: string,
 *   encoding: 'utf8' | 'base64',
 *   accountId: VwAccountId,
 * }} VwCall
 */

const vwItem = z.string().min(1, 'vw(): item name must be a non-empty string')
/** Omitted → {@link DEFAULT_VW_ACCOUNT} in the branch transforms. */
const vwAccountIdIn = z.string().min(1, 'vw(): account id must be a non-empty string').optional()
const vwEncoding = z.enum(['utf8', 'base64'], {
  error: 'vw(): encoding must be utf8 or base64',
})

/** `vw(..., attachment=, encoding?)` — encoding defaults to utf8. */
const vwAttachmentArgsSchema = z
  .strictObject({
    accountId: vwAccountIdIn,
    item: vwItem,
    attachment: z.string().min(1, 'vw(): attachment= must be a non-empty string'),
    encoding: vwEncoding.default('utf8'),
  })
  .transform((d) => ({
    kind: /** @type {const} */ ('attachment'),
    item: d.item,
    file: d.attachment,
    encoding: d.encoding,
    accountId: d.accountId ?? DEFAULT_VW_ACCOUNT,
  }))

/** `vw(...)` / `vw(..., field=)` — field defaults to password. */
const vwFieldArgsSchema = z
  .strictObject({
    accountId: vwAccountIdIn,
    item: vwItem,
    field: z.string().min(1, 'vw(): field= must be a non-empty string').default('password'),
  })
  .transform((d) => ({
    kind: /** @type {const} */ ('field'),
    item: d.item,
    field: d.field,
    accountId: d.accountId ?? DEFAULT_VW_ACCOUNT,
  }))

/** Attachment first; exclusivity is structural (each branch is strict). */
const vwArgsSchema = z.union([vwAttachmentArgsSchema, vwFieldArgsSchema])

/** Allowed `@initVw(...)` named arguments. */
const INIT_VW_KEYS = /** @type {const} */ ([
  'id',
  'appDataDir',
  'sessionToken',
  'masterPassword',
  'serverUrl',
  'clientId',
  'clientSecret',
  'sessionTtl',
  'cacheTtl',
  'syncTtl',
  'bin',
])

/**
 * @typedef {{
 *   id?: string,
 *   appDataDir?: string,
 *   sessionToken?: string,
 *   masterPassword?: string,
 *   serverUrl?: string,
 *   clientId?: string,
 *   clientSecret?: string,
 *   sessionTtl?: string | number,
 *   cacheTtl?: string | number,
 *   syncTtl?: string | number,
 *   bin?: string,
 * }} InitVwArgs
 */

/**
 * Opaque `@initVw` / varlock arg value before Zod validation.
 * @typedef {object} InitVwArgValue
 * @property {() => Promise<string | number | boolean | undefined>} [resolve]
 * @property {boolean} [isStatic]
 * @property {string | number | boolean | null} [staticValue]
 */

/**
 * Loose `@initVw` bag before Zod (unknown keys rejected).
 * @typedef {Record<
 *   string,
 *   string | number | boolean | null | undefined | InitVwArgValue
 * >} InitVwRawBag
 */

/** Omit the key to leave unset; blank strings are rejected. */
const initVwOptString = (/** @type {string} */ name) =>
  z.string().min(1, `@initVw: ${name} must be a non-empty string`).optional()

/**
 * Unresolved varlock decorator arg: either a literal or a resolver `{ resolve() }`.
 * @param {string} name
 */
const unresolvedStringArg = (name) =>
  z
    .union(
      [
        z.string(),
        z.custom(
          (v) =>
            typeof v === 'object'
            && v !== null
            && typeof (/** @type {InitVwArgValue} */ (v).resolve) === 'function',
          { error: `@initVw: ${name} must be a string or varlock resolver` },
        ),
      ],
      { error: `@initVw: ${name} must be a string or varlock resolver` },
    )
    .optional()

/**
 * TTL arg before resolve: duration string, ms number, or resolver.
 * @param {string} name
 */
const unresolvedTtlArg = (name) =>
  z
    .union(
      [
        z.string().min(1),
        z.number().finite(),
        z.custom(
          (v) =>
            typeof v === 'object'
            && v !== null
            && typeof (/** @type {InitVwArgValue} */ (v).resolve) === 'function',
          { error: `@initVw: ${name} must be a TTL string/number or varlock resolver` },
        ),
      ],
      { error: `@initVw: ${name} must be a TTL string/number or varlock resolver` },
    )
    .optional()

/**
 * Resolved cache TTL (`resolveCacheTtl` already ran in the plugin for schema args).
 * Accepts `"forever"`, a positive ms number, or a duration string with a unit.
 */
const resolvedCacheTtl = z
  .union([
    z
      .number()
      .finite()
      .positive({ error: '@initVw: TTL number must be a positive finite ms value' }),
    z.literal('forever'),
    z
      .string()
      .min(1)
      .refine(
        (v) => {
          const t = v.trim().toLowerCase()
          if (t === 'forever') return true
          return /^\d+(?:\.\d+)?\s*[a-z]+$/i.test(t)
        },
        { error: '@initVw: TTL must be "forever" or a duration like "5m", "1h", "30s"' },
      ),
  ])
  .optional()

/** Non-empty trimmed string (shared by bare `id=` and StaticValueResolver). */
const initVwIdString = z
  .string({ error: '@initVw: id= must be a non-empty string literal' })
  .trim()
  .min(1, '@initVw: id= must be a non-empty string literal')

/**
 * Varlock `id=perso` / `id="perso"` → StaticValueResolver; unwrap to the literal.
 * Dynamic resolvers (`$FOO`, function calls) fail the union.
 * `z.object` (not strict): resolvers also carry methods like `resolve`.
 */
const initVwIdStaticResolver = z
  .object({
    isStatic: z.literal(true),
    staticValue: initVwIdString,
  })
  .transform((o) => o.staticValue)

/**
 * Account id must be a static string at process time (keys the client map).
 */
const initVwIdLiteral = z
  .union([initVwIdString, initVwIdStaticResolver], {
    error: '@initVw: id= must be a non-empty string literal',
  })
  .optional()

const initVwIdRequiresAppDataDir = (/** @type {{ id?: string, appDataDir?: string }} */ data) =>
  data.id == null || data.appDataDir != null

/** Process-time `@initVw` args: known keys only; values still unresolved. */
const initVwKeysSchema = z
  .strictObject({
    id: initVwIdLiteral,
    appDataDir: unresolvedStringArg('appDataDir'),
    sessionToken: unresolvedStringArg('sessionToken'),
    masterPassword: unresolvedStringArg('masterPassword'),
    serverUrl: unresolvedStringArg('serverUrl'),
    clientId: unresolvedStringArg('clientId'),
    clientSecret: unresolvedStringArg('clientSecret'),
    sessionTtl: unresolvedTtlArg('sessionTtl'),
    cacheTtl: unresolvedTtlArg('cacheTtl'),
    syncTtl: unresolvedTtlArg('syncTtl'),
    bin: unresolvedStringArg('bin'),
  })
  .refine(initVwIdRequiresAppDataDir, {
    message: '@initVw: id= requires appDataDir=',
    path: ['appDataDir'],
  })

const initVwArgsSchema = z
  .strictObject({
    id: initVwOptString('id'),
    appDataDir: initVwOptString('appDataDir'),
    sessionToken: initVwOptString('sessionToken'),
    masterPassword: initVwOptString('masterPassword'),
    serverUrl: initVwOptString('serverUrl'),
    clientId: initVwOptString('clientId'),
    clientSecret: initVwOptString('clientSecret'),
    sessionTtl: resolvedCacheTtl,
    cacheTtl: resolvedCacheTtl,
    syncTtl: resolvedCacheTtl,
    bin: initVwOptString('bin'),
  })
  .refine(initVwIdRequiresAppDataDir, {
    message: '@initVw: id= requires appDataDir=',
    path: ['appDataDir'],
  })
  .refine((data) => Boolean(data.clientId) === Boolean(data.clientSecret), {
    message: '@initVw: clientId and clientSecret must both be set (or both omitted)',
    path: ['clientSecret'],
  })

/**
 * Resolve `@initVw` account key: omitted / empty `id` → {@link DEFAULT_VW_ACCOUNT}.
 * @param {string | undefined | null} id
 * @returns {VwAccountId}
 */
function resolveVwAccountId(id) {
  if (id == null) return DEFAULT_VW_ACCOUNT
  const t = String(id).trim()
  return t === '' ? DEFAULT_VW_ACCOUNT : t
}

/**
 * Human-readable account label for errors.
 * @param {VwAccountId} accountId
 * @returns {string}
 */
function formatVwAccountId(accountId) {
  return typeof accountId === 'symbol' ? '(default)' : JSON.stringify(accountId)
}

/**
 * @param {z.ZodError} err
 * @returns {string}
 */
function formatInitVwZodError(err) {
  return err.issues
    .map((i) => {
      if (i.code === 'unrecognized_keys') {
        const keys = 'keys' in i && Array.isArray(i.keys) ? i.keys.join(', ') : 'unknown'
        return `@initVw: unknown argument(s): ${keys}`
      }
      return i.message.startsWith('@initVw:') ? i.message : `@initVw: ${i.message}`
    })
    .join('; ')
}

/**
 * Reject unknown `@initVw` keys (call from plugin `process` before values resolve).
 * @param {InitVwRawBag | null | undefined} raw
 */
function parseInitVwArgKeys(raw) {
  const r = initVwKeysSchema.safeParse(raw ?? {})
  if (!r.success) throw new Error(formatInitVwZodError(r.error) || '@initVw: invalid arguments')
  return r.data
}

/**
 * Validate resolved `@initVw` options (after varlock resolver strings are awaited).
 * All keys optional; present values must be non-empty strings. Unknown keys rejected.
 * Expands a leading `~` on `appDataDir`.
 * @param {InitVwArgs | InitVwRawBag | null | undefined} raw
 * @returns {InitVwArgs}
 */
function parseInitVwArgs(raw) {
  const r = initVwArgsSchema.safeParse(raw ?? {})
  if (!r.success) throw new Error(formatInitVwZodError(r.error) || '@initVw: invalid arguments')
  const data = r.data
  if (data.appDataDir == null) return data
  return { ...data, appDataDir: expandHomePath(data.appDataDir) }
}

/** Built-in (non-custom) item fields. */
const STANDARD_FIELDS = ['password', 'username', 'notes', 'totp', 'uri']

module.exports = {
  DEFAULT_VW_ACCOUNT,
  expandHomePath,
  resolveVwAccountId,
  formatVwAccountId,
  vwArgsSchema,
  INIT_VW_KEYS,
  parseInitVwArgKeys,
  parseInitVwArgs,
  STANDARD_FIELDS,
}
