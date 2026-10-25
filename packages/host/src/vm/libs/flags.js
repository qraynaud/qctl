/**
 * Well-known VM flags and helpers to define new ones (name + Zod schema).
 * Wire format is JSON (`jsonCodec`); targets scope storage as `qctl.<name>`.
 */
import { z } from 'zod'

/** @import { VmFlagDef, VmFlagStore } from './flag-store.js' */

/** Local name only; targets scope as `qctl.<name>` (no dots in the name). */
const FLAG_NAME = /^[a-z][a-z0-9-]*$/

/** Thrown by {@link VmFlagStore.get} / `entry` when absent. */
export class VmFlagNotFoundError extends Error {
  /**
   * @param {string} flagName
   */
  constructor(flagName) {
    super(`vm flag ${JSON.stringify(flagName)} is not set`)
    this.name = 'VmFlagNotFoundError'
    /** @type {string} */
    this.flagName = flagName
  }
}

/**
 * Wire JSON string ↔ domain schema (mirrors guest supervisor `jsonCodec`).
 * @template {z.ZodType} S
 * @param {S} schema
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

/**
 * @template {z.ZodType} S
 * @param {string} name
 * @param {S} schema
 * @returns {VmFlagDef<S>}
 */
export function defineFlag(name, schema) {
  if (!FLAG_NAME.test(name)) {
    throw new Error(
      `vm flag name ${JSON.stringify(name)} must match ${FLAG_NAME} (scoped as qctl.<name>)`,
    )
  }
  return Object.freeze({ name, schema })
}

/** First-boot finished successfully. */
export const INSTALLED = defineFlag('installed', z.boolean())
