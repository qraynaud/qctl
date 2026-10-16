import { z } from 'zod'

export const IFACE_RE = /^[A-Za-z][A-Za-z0-9._-]*$/
export const BRIDGE_RE = /^[A-Za-z][A-Za-z0-9._-]*$/

/**
 * Provision scalars may be plain strings or `Buffer` from resolved `!env`.
 * Layer `.nullable()` / `.optional()` at the call site (or on the helpers below).
 */
export const bufferOrString = z.union([z.instanceof(Buffer), z.string()])

/**
 * Required trimmed text from a string or `!env` Buffer (e.g. registries lines).
 */
export const trimmedText = bufferOrString.transform((v) => {
  return (Buffer.isBuffer(v) ? v.toString('utf8') : v).trim()
})

/**
 * Optional text slot: empty / omitted → undefined.
 * YAML `null` is rejected (omit the key instead).
 */
export const optionalTrimmedText = trimmedText
  .transform((t) => (t === '' ? undefined : t))
  .optional()

/**
 * Optional credential bytes: keep `Buffer`, trim strings. Empty / omitted → undefined.
 * YAML `null` is rejected (omit the key instead).
 */
export const optionalCredentialBytes = bufferOrString
  .transform((v) => {
    if (Buffer.isBuffer(v)) return v.length ? v : undefined
    const t = v.trim()
    return t === '' ? undefined : t
  })
  .optional()

/**
 * Optional id string: blank / omitted → undefined (callers may default from a map key).
 */
export const optionalTrimmedId = z
  .string()
  .transform((s) => {
    const t = s.trim()
    return t === '' ? undefined : t
  })
  .optional()

/**
 * Named map whose entries may omit `id`; output guarantees `id` (default = map key).
 *
 * @template {z.ZodObject<{ id?: typeof optionalTrimmedId }>} TIn
 * @param {TIn} entryIn
 * @param {z.ZodString} [keySchema] map key schema (default: non-empty trimmed string)
 */
export function mapWithIdDefault(entryIn, keySchema = z.string().trim().min(1)) {
  /**
   * @typedef {z.ZodPipe<
   *   z.ZodRecord<typeof keySchema, TIn>,
   *   z.ZodTransform<
   *     Record<z.infer<typeof keySchema>, Omit<z.infer<TIn>, 'id'> & { id: string }>,
   *     z.output<z.ZodRecord<typeof keySchema, TIn>>
   *   >
   * >} OutType
   */
  return /** @type {OutType} */ (
    z
      .record(keySchema, entryIn)
      .transform((map) =>
        Object.fromEntries(
          Object.entries(map).map(([key, val]) => [key, { ...val, id: val.id ?? key }]),
        ),
      )
  )
}

/**
 * @param {z.ZodError} error
 * @param {(string|number)[]} prefix path segments from provision root
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
 * Format a Zod failure with a source label (file path / basename).
 * @param {z.ZodError} error
 * @param {string} source
 * @param {(string|number)[]} [pathPrefix]
 */
export function formatProvisionError(error, source, pathPrefix = []) {
  return `${source}:\n${z.prettifyError(withRootPath(error, pathPrefix))}`
}
