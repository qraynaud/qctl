/**
 * NDJSON RPC over the supervisor unix sockets.
 *
 * Domain shapes are Zod schemas; wire framing is `z.codec(string ↔ schema)` so
 * client and server share the same encode/decode path (no one-way transforms).
 */
import { z } from 'zod'

/** @typedef {'apps' | 'admin'} SocketKind */

/**
 * Supervisor RPC method names (apps socket ⊂ all; admin adds QUADLET).
 * SECRET is on apps too (scoped Pre); param ACL still requires `app` there.
 * @see js-enum-pattern
 */
export const SUPERVISOR_METHOD = Object.freeze({
  ENSURE: 'ensure',
  RELEASE: 'release',
  STATUS: 'status',
  WATCH: 'watch',
  QUADLET: 'quadlet',
  SECRET: 'secret',
})

/** @typedef {typeof SUPERVISOR_METHOD[keyof typeof SUPERVISOR_METHOD]} SupervisorMethod */

/** Methods allowed on the apps socket (dependency proxies + scoped secret). */
export const APPS_METHODS = Object.freeze([
  SUPERVISOR_METHOD.ENSURE,
  SUPERVISOR_METHOD.RELEASE,
  SUPERVISOR_METHOD.STATUS,
  SUPERVISOR_METHOD.WATCH,
  SUPERVISOR_METHOD.SECRET,
])

/** Extra methods allowed only on the admin socket (day-2 quadlet control). */
export const ADMIN_ONLY_METHODS = Object.freeze([SUPERVISOR_METHOD.QUADLET])

/** Methods that stream stdout/stderr frames before the final response. */
export const STREAMING_METHODS = Object.freeze([
  SUPERVISOR_METHOD.QUADLET,
  SUPERVISOR_METHOD.SECRET,
])

/**
 * Non-empty string with no leading/trailing whitespace.
 * Rejects padded values instead of silently trimming.
 */
const nonEmpty = z
  .string()
  .min(1)
  .refine((s) => s === s.trim(), { message: 'must not have leading or trailing whitespace' })

const requestIdSchema = nonEmpty.optional()

const appParamsSchema = z.strictObject({
  app: nonEmpty,
})

export const ensureRequestSchema = z.strictObject({
  id: requestIdSchema,
  method: z.literal(SUPERVISOR_METHOD.ENSURE),
  params: appParamsSchema,
})

export const releaseRequestSchema = z.strictObject({
  id: requestIdSchema,
  method: z.literal(SUPERVISOR_METHOD.RELEASE),
  params: appParamsSchema,
})

export const statusRequestSchema = z.strictObject({
  id: requestIdSchema,
  method: z.literal(SUPERVISOR_METHOD.STATUS),
  params: appParamsSchema,
})

export const watchRequestSchema = z.strictObject({
  id: requestIdSchema,
  method: z.literal(SUPERVISOR_METHOD.WATCH),
  params: appParamsSchema,
})

/** Quadlet ops on the admin socket (structured; not raw argv). */
export const QUADLET_OP = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  ENABLE: 'enable',
  START: 'start',
  STOP: 'stop',
  RESTART: 'restart',
  PS: 'ps',
})

/** @typedef {typeof QUADLET_OP[keyof typeof QUADLET_OP]} QuadletOp */

const appsRequired = nonEmpty.array().min(1)
const appsOptional = nonEmpty.array().optional()

export const quadletParamsSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal(QUADLET_OP.UP),
    apps: appsOptional,
    dryRun: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal(QUADLET_OP.DOWN),
    apps: appsRequired,
  }),
  z.strictObject({
    op: z.literal(QUADLET_OP.ENABLE),
    apps: appsRequired,
    install: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal(QUADLET_OP.START),
    apps: appsRequired,
  }),
  z.strictObject({
    op: z.literal(QUADLET_OP.STOP),
    apps: appsRequired,
  }),
  z.strictObject({
    op: z.literal(QUADLET_OP.RESTART),
    apps: appsRequired,
  }),
  z.strictObject({
    op: z.literal(QUADLET_OP.PS),
    apps: appsOptional,
  }),
])

export const quadletRequestSchema = z.strictObject({
  id: requestIdSchema,
  method: z.literal(SUPERVISOR_METHOD.QUADLET),
  params: quadletParamsSchema,
})

/** Secret ops (structured; not raw argv). */
export const SECRET_OP = Object.freeze({
  SYNC: 'sync',
  CHECK: 'check',
})

/** @typedef {typeof SECRET_OP[keyof typeof SECRET_OP]} SecretOp */

const secretAppOptional = nonEmpty.optional()

export const secretParamsSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal(SECRET_OP.SYNC),
    app: secretAppOptional,
    dryRun: z.boolean().optional(),
    restart: z.boolean().optional(),
    env: nonEmpty.optional(),
  }),
  z.strictObject({
    op: z.literal(SECRET_OP.CHECK),
    app: secretAppOptional,
    env: nonEmpty.optional(),
  }),
])

export const secretRequestSchema = z.strictObject({
  id: requestIdSchema,
  method: z.literal(SUPERVISOR_METHOD.SECRET),
  params: secretParamsSchema,
})

export const supervisorRequestSchema = z.discriminatedUnion('method', [
  ensureRequestSchema,
  releaseRequestSchema,
  statusRequestSchema,
  watchRequestSchema,
  quadletRequestSchema,
  secretRequestSchema,
])

export const ensureResultSchema = z.strictObject({
  method: z.literal(SUPERVISOR_METHOD.ENSURE),
  app: nonEmpty,
  refs: z.number().int().positive(),
  engine: z.enum(['rootless', 'rootful']),
  started: z.boolean(),
})

export const releaseResultSchema = z.strictObject({
  method: z.literal(SUPERVISOR_METHOD.RELEASE),
  app: nonEmpty,
  refs: z.number().int().nonnegative(),
  stopped: z.boolean(),
})

export const statusResultSchema = z.strictObject({
  method: z.literal(SUPERVISOR_METHOD.STATUS),
  app: nonEmpty,
  ready: z.boolean(),
  failed: z.boolean(),
})

export const watchResultSchema = z.strictObject({
  method: z.literal(SUPERVISOR_METHOD.WATCH),
  app: nonEmpty,
  reason: z.enum(['cleared', 'failed']),
})

export const quadletResultSchema = z.strictObject({
  method: z.literal(SUPERVISOR_METHOD.QUADLET),
  exitCode: z.number().int(),
})

export const secretResultSchema = z.strictObject({
  method: z.literal(SUPERVISOR_METHOD.SECRET),
  exitCode: z.number().int(),
})

export const supervisorResultSchema = z.discriminatedUnion('method', [
  ensureResultSchema,
  releaseResultSchema,
  statusResultSchema,
  watchResultSchema,
  quadletResultSchema,
  secretResultSchema,
])

export const supervisorOkSchema = z.strictObject({
  id: requestIdSchema,
  ok: z.literal(true),
  result: supervisorResultSchema.optional(),
})

export const supervisorErrSchema = z.strictObject({
  id: requestIdSchema,
  ok: z.literal(false),
  error: nonEmpty,
})

export const supervisorResponseSchema = z.discriminatedUnion('ok', [
  supervisorOkSchema,
  supervisorErrSchema,
])

/**
 * Intermediate NDJSON frame while a long RPC (quadlet/secret) streams stdio.
 * Distinct from {@link supervisorOkSchema} (no `ok` / `result`).
 */
export const supervisorStreamSchema = z.strictObject({
  id: requestIdSchema,
  stream: z.enum(['stdout', 'stderr']),
  data: z.string(),
})

/** @typedef {z.infer<typeof supervisorRequestSchema>} SupervisorRequest */
/** @typedef {z.infer<typeof ensureRequestSchema>} EnsureRequest */
/** @typedef {z.infer<typeof releaseRequestSchema>} ReleaseRequest */
/** @typedef {z.infer<typeof statusRequestSchema>} StatusRequest */
/** @typedef {z.infer<typeof watchRequestSchema>} WatchRequest */
/** @typedef {z.infer<typeof quadletParamsSchema>} QuadletParams */
/** @typedef {z.infer<typeof quadletRequestSchema>} QuadletRequest */
/** @typedef {z.infer<typeof secretParamsSchema>} SecretParams */
/** @typedef {z.infer<typeof secretRequestSchema>} SecretRequest */
/** @typedef {z.infer<typeof ensureResultSchema>} EnsureResult */
/** @typedef {z.infer<typeof releaseResultSchema>} ReleaseResult */
/** @typedef {z.infer<typeof statusResultSchema>} StatusResult */
/** @typedef {z.infer<typeof watchResultSchema>} WatchResult */
/** @typedef {z.infer<typeof quadletResultSchema>} QuadletResult */
/** @typedef {z.infer<typeof secretResultSchema>} SecretResult */
/** @typedef {z.infer<typeof supervisorResultSchema>} SupervisorResult */
/** @typedef {z.infer<typeof supervisorResponseSchema>} SupervisorResponse */
/** @typedef {z.infer<typeof supervisorOkSchema>} SupervisorOk */
/** @typedef {z.infer<typeof supervisorErrSchema>} SupervisorErr */
/** @typedef {z.infer<typeof supervisorStreamSchema>} SupervisorStream */

/**
 * Wire JSON string ↔ domain schema (shared client/server).
 * @template {z.ZodType} T
 * @param {T} schema
 */
export function jsonCodec(schema) {
  return z.codec(z.string(), schema, {
    decode: (jsonString, ctx) => {
      try {
        return JSON.parse(jsonString)
      } catch (err) {
        ctx.issues.push({
          code: 'invalid_format',
          format: 'json',
          input: jsonString,
          message: err instanceof Error ? err.message : String(err),
        })
        return z.NEVER
      }
    },
    encode: (value) => JSON.stringify(value),
  })
}

export const supervisorRequestCodec = jsonCodec(supervisorRequestSchema)
export const supervisorResponseCodec = jsonCodec(supervisorResponseSchema)
export const supervisorStreamCodec = jsonCodec(supervisorStreamSchema)

/**
 * @param {string} method
 * @returns {boolean}
 */
export function isAppsMethod(method) {
  return APPS_METHODS.includes(/** @type {typeof APPS_METHODS[number]} */ (method))
}

/**
 * @param {string} method
 * @returns {boolean}
 */
export function isAdminOnlyMethod(method) {
  return ADMIN_ONLY_METHODS.includes(/** @type {typeof ADMIN_ONLY_METHODS[number]} */ (method))
}

/**
 * @param {string} method
 * @returns {boolean}
 */
export function isStreamingMethod(method) {
  return STREAMING_METHODS.includes(/** @type {typeof STREAMING_METHODS[number]} */ (method))
}

/**
 * Decode one NDJSON request line (trailing newline optional).
 * @param {string} line
 * @returns {SupervisorRequest}
 */
export function decodeRequestLine(line) {
  return supervisorRequestCodec.decode(line.replace(/\n$/, ''))
}

/**
 * Encode a request as one NDJSON line (includes trailing newline).
 * @param {SupervisorRequest} req
 * @returns {string}
 */
export function encodeRequestLine(req) {
  return `${supervisorRequestCodec.encode(req)}\n`
}

/**
 * Decode one NDJSON response line (trailing newline optional).
 * @param {string} line
 * @returns {SupervisorResponse}
 */
export function decodeResponseLine(line) {
  return supervisorResponseCodec.decode(line.replace(/\n$/, ''))
}

/**
 * Encode a response as one NDJSON line (includes trailing newline).
 * @param {SupervisorResponse} res
 * @returns {string}
 */
export function encodeResponseLine(res) {
  return `${supervisorResponseCodec.encode(res)}\n`
}

/**
 * Encode a stdio stream frame as one NDJSON line (includes trailing newline).
 * @param {SupervisorStream} frame
 * @returns {string}
 */
export function encodeStreamLine(frame) {
  return `${supervisorStreamCodec.encode(frame)}\n`
}

/**
 * Decode a stream frame or final response (trailing newline optional).
 * @param {string} line
 * @returns {SupervisorStream | SupervisorResponse}
 */
export function decodeWireLine(line) {
  const raw = line.replace(/\n$/, '')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err))
  }
  if (parsed && typeof parsed === 'object' && 'stream' in parsed) {
    return supervisorStreamSchema.parse(parsed)
  }
  return supervisorResponseSchema.parse(parsed)
}
