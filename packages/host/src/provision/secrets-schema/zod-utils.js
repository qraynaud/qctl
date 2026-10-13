import { z } from 'zod'

export const IFACE_RE = /^[A-Za-z][A-Za-z0-9._-]*$/
export const BRIDGE_RE = /^[A-Za-z][A-Za-z0-9._-]*$/

/**
 * Provision scalars may be plain strings or `Buffer` from resolved `!env`.
 */
export const bufferOrString = z.union([z.instanceof(Buffer), z.string(), z.null(), z.undefined()])

/**
 * Text slot: Buffer → utf8, then trim. Empty → null.
 */
export const optionalTrimmedText = bufferOrString.transform((v) => {
  if (v == null) return null
  const t = (Buffer.isBuffer(v) ? v.toString('utf8') : String(v)).trim()
  return t === '' ? null : t
})

/**
 * Required trimmed text from a string or `!env` Buffer (e.g. registries lines).
 */
export const trimmedText = z.union([z.instanceof(Buffer), z.string()]).transform((v) => {
  return (Buffer.isBuffer(v) ? v.toString('utf8') : String(v)).trim()
})

/**
 * Opaque credential bytes: keep `Buffer`, trim strings. Empty → null.
 */
export const optionalCredentialBytes = bufferOrString.transform((v) => {
  if (v == null) return null
  if (Buffer.isBuffer(v)) return v.length ? v : null
  const t = v.trim()
  return t === '' ? null : t
})

/**
 * Named map entry after `namedMapToList` (name key + original fields).
 *
 * @typedef {{ name: string } & Record<string, unknown>} NamedYamlEntry
 */

/**
 * @param {z.ZodError} error
 * @param {(string|number)[]} prefix path segments from secrets root
 */
export function withRootPath(error, prefix) {
  if (!prefix.length) return error
  return new z.ZodError(
    error.issues.map((issue) => ({
      ...issue,
      path: [...prefix, ...issue.path],
    })),
  )
}

/**
 * @param {z.ZodError} error
 * @param {string} source
 * @param {(string|number)[]} [pathPrefix]
 */
export function formatSecretsError(error, source, pathPrefix = []) {
  return `${source}:\n${z.prettifyError(withRootPath(error, pathPrefix))}`
}

/**
 * Parse `raw` with `schema`, formatting Zod failures like other secrets helpers.
 * Input is `unknown` (same as `schema.safeParse`); output is `z.infer<S>`.
 *
 * @template {z.ZodType} S
 * @param {S} schema
 * @param {unknown} raw
 * @param {string} [source]
 * @param {(string|number)[]} [pathPrefix]
 * @returns {z.infer<S>}
 */
export function parseSecretsSchema(schema, raw, source = 'secrets', pathPrefix = []) {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error(formatSecretsError(result.error, source, pathPrefix))
  }
  return result.data
}

/**
 * Map → list of `{ name, ...fields }`. Rejects arrays (use maps for merge).
 * @param {unknown} raw
 * @param {z.RefinementCtx} ctx
 * @param {(string|number)[]} path
 * @returns {NamedYamlEntry[] | typeof z.NEVER}
 */
export function namedMapToList(raw, ctx, path) {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    ctx.addIssue({
      code: 'custom',
      message: 'must be a map keyed by name (not a list) — e.g. ports.ssh: { port: 22 }',
      path,
    })
    return z.NEVER
  }
  if (typeof raw !== 'object') {
    ctx.addIssue({
      code: 'custom',
      message: 'must be a map keyed by name',
      path,
    })
    return z.NEVER
  }
  return Object.entries(/** @type {Record<string, unknown>} */ (raw)).map(([name, val]) => {
    if (val != null && (typeof val !== 'object' || Array.isArray(val))) {
      ctx.addIssue({
        code: 'custom',
        message: 'each entry must be a mapping',
        path: [...path, name],
      })
      return /** @type {NamedYamlEntry} */ ({ name })
    }
    return /** @type {NamedYamlEntry} */ ({
      name,
      ...(val && typeof val === 'object' ? /** @type {Record<string, unknown>} */ (val) : {}),
    })
  })
}
