/**
 * Host meta from `provision/common.yaml` `qctl:` — environments + profiles.
 * Bootstrap only (no full provision merge); built-ins apply when fields are omitted.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { COMMON_PROVISION } from './load.js'
import { BUILTIN_ENVIRONMENTS, isProductionEnv } from './production.js'
import { parseProvisionYaml } from './yaml.js'

export { BUILTIN_ENVIRONMENTS, isProductionEnv } from './production.js'

/** @import { YamlMapping } from '../yaml.js' */

/**
 * Formerly reserved layer basenames. Prefixed files (`env-*` / `target-*` /
 * `profile-*`) remove collisions — always false; kept for call-site compat.
 * @param {string} _name
 * @returns {boolean}
 */
export function isReservedProvisionName(_name) {
  return false
}

/** Env / profile map keys (basename-safe; no path separators). */
export const provisionLayerNameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^./\\]+$/, 'must not contain "." or "/"')

export const environmentSpecSchema = z.strictObject({
  production: z.boolean().default(false),
})

export const profileSpecSchema = z.strictObject({
  env: z.string().trim().min(1),
  target: z.enum(['workstation', 'proxmox']),
})

/** Raw `qctl` fields read from common.yaml (before built-ins). */
export const qctlHostMetaFieldsSchema = z.strictObject({
  environments: z
    .record(provisionLayerNameSchema, environmentSpecSchema)
    .refine((m) => Object.keys(m).length > 0, { message: 'must not be empty when present' })
    .optional(),
  profiles: z
    .record(provisionLayerNameSchema, profileSpecSchema)
    .refine((m) => Object.keys(m).length > 0, { message: 'must not be empty when present' })
    .optional(),
  /** string = default; null = require `-p` (even with 1 profile); omit = sole profile or null */
  'default-profile': z.union([z.string().trim().min(1), z.null()]).optional(),
})

/** @typedef {z.infer<typeof environmentSpecSchema>} EnvironmentSpec */
/** @typedef {z.infer<typeof profileSpecSchema>} ProfileSpec */
/** @typedef {z.infer<typeof qctlHostMetaFieldsSchema>} QctlHostMetaFields */

/**
 * @typedef {object} QctlHostMeta
 * @property {Record<string, EnvironmentSpec>} environments
 * @property {Record<string, ProfileSpec>} profiles
 * @property {string | null} defaultProfile
 *   effective default key, or null when unset / explicit `default-profile: null`
 */

/**
 * @typedef {object} ResolvedProfile
 * @property {string} key
 * @property {string} env
 * @property {'workstation' | 'proxmox'} target
 * @property {boolean} production
 */

/** Built-in when `qctl.profiles` is omitted. */
export const BUILTIN_PROFILES = Object.freeze({
  default: Object.freeze({ env: 'dev', target: /** @type {'workstation'} */ ('workstation') }),
})

/**
 * @returns {Record<string, EnvironmentSpec>}
 */
function cloneBuiltinEnvironments() {
  return {
    dev: { production: BUILTIN_ENVIRONMENTS.dev.production },
    prod: { production: BUILTIN_ENVIRONMENTS.prod.production },
  }
}

/**
 * @returns {Record<string, ProfileSpec>}
 */
function cloneBuiltinProfiles() {
  return {
    default: { env: 'dev', target: 'workstation' },
  }
}

/**
 * Built-ins + default-profile rename. Spread `rest` so `.extend({ platform })` extras survive.
 * @template {QctlHostMetaFields} T
 * @param {T} fields
 * @returns {Omit<T, 'environments' | 'profiles' | 'default-profile'> & QctlHostMeta}
 */
export function enrichQctlHostMetaFields(fields) {
  const {
    environments: rawEnvs,
    profiles: rawProfiles,
    'default-profile': rawDefault,
    ...rest
  } = fields
  const environments = rawEnvs ?? cloneBuiltinEnvironments()
  const profiles = rawProfiles ?? cloneBuiltinProfiles()
  const keys = Object.keys(profiles)
  // Explicit `null` keeps no default (require `-p`). Omitted → sole profile, else null.
  const defaultProfile =
    rawDefault !== undefined ? rawDefault : keys.length === 1 ? (keys[0] ?? null) : null
  return { ...rest, environments, profiles, defaultProfile }
}

/**
 * Cross-field checks after enrichment (profile.env ∈ environments, defaultProfile ∈ profiles).
 * @param {QctlHostMeta} data
 * @param {z.RefinementCtx} ctx
 */
export function refineQctlHostMeta(data, ctx) {
  const { environments, profiles, defaultProfile } = data
  const envKeys = Object.keys(environments).sort().join(', ')
  for (const [profileKey, profile] of Object.entries(profiles)) {
    if (!(profile.env in environments)) {
      ctx.addIssue({
        code: 'custom',
        message: `env ${JSON.stringify(profile.env)} is not in qctl.environments (${envKeys})`,
        path: ['profiles', profileKey, 'env'],
      })
    }
  }
  if (defaultProfile != null && !(defaultProfile in profiles)) {
    const keys = Object.keys(profiles).sort().join(', ')
    ctx.addIssue({
      code: 'custom',
      message: `${JSON.stringify(defaultProfile)} is not a profile key (${keys})`,
      path: ['default-profile'],
    })
  }
}

/** Fields schema → enriched host meta. */
export const qctlHostMetaSchema = qctlHostMetaFieldsSchema
  .transform(enrichQctlHostMetaFields)
  .superRefine(refineQctlHostMeta)

/** @typedef {z.infer<typeof qctlHostMetaSchema>} QctlHostMetaParsed */

/**
 * @param {string} source
 * @param {z.ZodError} error
 */
function formatHostMetaError(source, error) {
  return `${source}:\n${z.prettifyError(error)}`
}

/**
 * Soft-parse `provision/common.yaml` for `qctl.environments` / `profiles` / `default-profile`.
 * @param {string} root - instance repo root
 * @returns {QctlHostMeta}
 */
export function loadQctlHostMeta(root) {
  const commonPath = join(root, 'provision', `${COMMON_PROVISION}.yaml`)
  /** @type {YamlMapping | null} */
  let qctl = null

  if (existsSync(commonPath)) {
    const doc = parseProvisionYaml(readFileSync(commonPath, 'utf8'), commonPath)
    if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
      const block = /** @type {YamlMapping} */ (doc).qctl
      if (block != null && typeof block === 'object' && !Array.isArray(block)) {
        qctl = /** @type {YamlMapping} */ (block)
      }
    }
  }

  // YAML boundary: Zod validates shape; cast input from untyped mapping.
  const parsed = qctlHostMetaSchema.safeParse(
    /** @type {z.input<typeof qctlHostMetaFieldsSchema>} */ ({
      environments: qctl?.environments,
      profiles: qctl?.profiles,
      'default-profile': (() => {
        const v = qctl?.['default-profile']
        if (v === null) return null
        if (typeof v === 'string') return v
        return undefined
      })(),
    }),
  )
  if (!parsed.success) {
    throw new Error(formatHostMetaError(commonPath, parsed.error))
  }
  return parsed.data
}

/**
 * Resolve which profile to use (CLI name or effective default).
 * @param {{ root: string, profile?: string | null }} opts
 * @returns {ResolvedProfile}
 */
export function resolveProfile(opts) {
  const meta = loadQctlHostMeta(opts.root)
  const requested =
    opts.profile != null && String(opts.profile).trim() !== '' ? String(opts.profile).trim() : null

  /** @type {string | null} */
  let key = requested
  if (!key) {
    key = meta.defaultProfile
  }
  if (!key) {
    const keys = Object.keys(meta.profiles).sort()
    throw new Error(
      `profile required: qctl.default-profile is unset (pass -p; known: ${keys.join(', ')})`,
    )
  }
  const spec = meta.profiles[key]
  if (!spec) {
    const keys = Object.keys(meta.profiles).sort()
    throw new Error(`unknown profile ${JSON.stringify(key)} (known: ${keys.join(', ')})`)
  }
  return {
    key,
    env: spec.env,
    target: spec.target,
    production: isProductionEnv(spec.env, meta.environments),
  }
}
