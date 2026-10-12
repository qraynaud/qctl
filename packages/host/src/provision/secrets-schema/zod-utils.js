import { z } from 'zod'

/** @import { YamlMapping, YamlValue } from '@qctl/shared' */

export const IFACE_RE = /^[A-Za-z][A-Za-z0-9._-]*$/
export const BRIDGE_RE = /^[A-Za-z][A-Za-z0-9._-]*$/

/**
 * Named YAML map entry after `namedMapToList` (name key + original fields).
 *
 * @typedef {{ name: string } & YamlMapping} NamedYamlEntry
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
 *
 * @template {z.ZodType} S
 * @param {S} schema
 * @param {YamlValue} raw
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
 * YAML map → list of `{ name, ...fields }`. Rejects arrays (use maps for merge).
 * @param {YamlValue} raw
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
  return Object.entries(raw).map(([name, val]) => {
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
      ...(val && typeof val === 'object' ? val : {}),
    })
  })
}
