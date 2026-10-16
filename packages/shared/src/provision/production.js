/**
 * Production-env flag helpers (no deps — safe for varlock ↔ provision imports).
 */

/** Built-in when `qctl.environments` is omitted. */
export const BUILTIN_ENVIRONMENTS = Object.freeze({
  dev: Object.freeze({ production: false }),
  prod: Object.freeze({ production: true }),
})

/**
 * @param {string} env
 * @param {Record<string, { production?: boolean }>} environments
 * @returns {boolean}
 */
export function isProductionEnv(env, environments) {
  return environments[env]?.production === true
}
