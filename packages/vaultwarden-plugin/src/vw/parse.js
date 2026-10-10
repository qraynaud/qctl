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
 * @typedef {{ kind: 'field', item: string, field: string, accountId: VwAccountId }
 *   | { kind: 'attachment', item: string, file: string, encoding: 'utf8' | 'base64', accountId: VwAccountId }} VwCall
 */

const vwArgsSchema = z
  .object({
    /** Omitted / empty → {@link DEFAULT_VW_ACCOUNT}. */
    accountId: z.string().min(1, 'vw(): account id must be a non-empty string').optional(),
    item: z.string().min(1, 'vw(): item name must be a non-empty string'),
    field: z.string().min(1, 'vw(): field= must be a non-empty string').optional(),
    attachment: z.string().min(1, 'vw(): attachment= must be a non-empty string').optional(),
    encoding: z
      .enum(['utf8', 'base64'], {
        error: 'vw(): encoding must be utf8 or base64',
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.field !== undefined && data.attachment !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'vw(): use field= or attachment=, not both',
        path: ['field'],
      })
    }
    if (data.encoding !== undefined && data.attachment === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'vw(): encoding= requires attachment=',
        path: ['encoding'],
      })
    }
  })
  .transform((data) => {
    const accountId = data.accountId ?? DEFAULT_VW_ACCOUNT
    if (data.attachment !== undefined) {
      return {
        kind: /** @type {const} */ ('attachment'),
        item: data.item,
        file: data.attachment,
        encoding: data.encoding ?? 'utf8',
        accountId,
      }
    }
    return {
      kind: /** @type {const} */ ('field'),
      item: data.item,
      field: data.field ?? 'password',
      accountId,
    }
  })

/**
 * Validate resolved `vw()` arguments (after varlock resolver strings are awaited).
 * @param {{
 *   accountId?: string,
 *   item?: string,
 *   field?: string,
 *   attachment?: string,
 *   encoding?: string,
 * }} raw
 * @returns {VwCall}
 */
function parseVwArgs(raw) {
  const r = vwArgsSchema.safeParse(raw)
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message).join('; ')
    throw new Error(msg || 'vw(): invalid arguments')
  }
  return r.data
}

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

/** Empty string → undefined so `$BW_SESSION` can be unset in the graph. */
const initVwOptString = (/** @type {string} */ name) =>
  z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.string().min(1, `@initVw: ${name} must be a non-empty string`).optional(),
  )

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
            && typeof (/** @type {{ resolve?: unknown }} */ (v).resolve) === 'function',
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
            && typeof (/** @type {{ resolve?: unknown }} */ (v).resolve) === 'function',
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

/**
 * Unwrap varlock process-time args: bare literals arrive as StaticValueResolver
 * (`{ isStatic: true, staticValue }`), not plain strings.
 * @param {unknown} v
 * @returns {unknown}
 */
function unwrapStaticArg(v) {
  if (v == null || v === '') return undefined
  if (typeof v === 'string') return v
  if (
    typeof v === 'object'
    && /** @type {{ isStatic?: boolean }} */ (v).isStatic === true
    && typeof (/** @type {{ staticValue?: unknown }} */ (v).staticValue) === 'string'
  ) {
    return /** @type {{ staticValue: string }} */ (v).staticValue
  }
  return v
}

/**
 * Account id must be a static string at process time (keys the client map).
 * Varlock wraps `id=perso` / `id="perso"` as StaticValueResolver — both OK.
 * Dynamic resolvers (`$FOO`, function calls) are rejected.
 */
const initVwIdLiteral = z.preprocess(
  (v) => {
    const unwrapped = unwrapStaticArg(v)
    if (unwrapped == null || unwrapped === '') return undefined
    return unwrapped
  },
  z
    .string({ error: '@initVw: id= must be a non-empty string literal' })
    .trim()
    .min(1, '@initVw: id= must be a non-empty string literal')
    .optional(),
)

/** Process-time `@initVw` args: known keys only; values still unresolved. */
const initVwKeysSchema = z
  .object({
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
  .strict()
  .superRefine((data, ctx) => {
    // Named accounts need a dedicated bw data dir so vaults do not clash.
    if (data.id != null && data.appDataDir == null) {
      ctx.addIssue({
        code: 'custom',
        message: '@initVw: id= requires appDataDir=',
        path: ['appDataDir'],
      })
    }
  })

const initVwArgsSchema = z
  .object({
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
  .strict()
  .superRefine((data, ctx) => {
    if (Boolean(data.clientId) !== Boolean(data.clientSecret)) {
      ctx.addIssue({
        code: 'custom',
        message: '@initVw: clientId and clientSecret must both be set (or both omitted)',
        path: data.clientId ? ['clientSecret'] : ['clientId'],
      })
    }
    if (data.id != null && data.appDataDir == null) {
      ctx.addIssue({
        code: 'custom',
        message: '@initVw: id= requires appDataDir=',
        path: ['appDataDir'],
      })
    }
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
 * @param {Record<string, unknown>} raw
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
 * @param {InitVwArgs} raw
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
  parseVwArgs,
  INIT_VW_KEYS,
  parseInitVwArgKeys,
  parseInitVwArgs,
  STANDARD_FIELDS,
}
