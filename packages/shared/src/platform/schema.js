/**
 * Zod schemas + parse helpers for platform modules (guest/host tooling).
 * Platform packages should use {@link ./define.js} instead (no Zod dependency).
 */
import { z } from 'zod'

import { packagesPipxItemSchema } from '../packages/manifest.js'
import { REQUIRED_PLATFORM_CAPABILITIES } from './required-capabilities.js'

export const requiredPlatformCapabilitySchema = z.enum(REQUIRED_PLATFORM_CAPABILITIES)

const pkgName = z.string().trim().min(1)
/** Open capability key (required names + FS / extras). */
const capName = z.string().trim().min(1)

export const platformCapabilityRecipeSchema = z.strictObject({
  needs: z.array(capName).optional(),
  distro: z.array(pkgName).optional(),
  pipx: z.array(packagesPipxItemSchema).optional(),
})

/**
 * @param {readonly string[] | undefined} [filesystems]
 * @returns {[string, ...string[]] | undefined}
 */
function nonEmptyFsTuple(filesystems) {
  if (filesystems == null || filesystems.length === 0) return undefined
  return /** @type {[string, ...string[]]} */ ([...filesystems])
}

/**
 * Packages map: required caps (+ optional FS enum keys) must all be present;
 * additional capability keys allowed via the open string record.
 *
 * @param {readonly string[] | undefined} [filesystems]
 */
export function platformPackagesMapSchemaFor(filesystems) {
  const fs = nonEmptyFsTuple(filesystems)
  const required = z.record(requiredPlatformCapabilitySchema, platformCapabilityRecipeSchema)
  const open = z.record(z.string(), platformCapabilityRecipeSchema)
  if (!fs) return required.and(open)
  return required.and(z.record(z.enum(fs), platformCapabilityRecipeSchema)).and(open)
}

/** Required capabilities only (no platform-specific FS keys). */
export const platformPackagesMapSchema = platformPackagesMapSchemaFor()

const platformOsDiskSchema = z.strictObject({
  id: z.string().trim().min(1).optional(),
  size: z.string().trim().min(1).optional(),
})

const platformNetworkingSchema = z
  .strictObject({
    planEnsureUp: z.custom((v) => v === undefined || typeof v === 'function').optional(),
    ensureUp: z.custom((v) => v === undefined || typeof v === 'function').optional(),
    planApplyDnat: z.custom((v) => v === undefined || typeof v === 'function').optional(),
    applyDnat: z.custom((v) => v === undefined || typeof v === 'function').optional(),
  })
  .optional()

/**
 * Platform module schema. When `filesystems` is passed, packages must include
 * those FS capability keys, `defaultFs` ∈ filesystems, and `osDisk` is required.
 *
 * @param {readonly string[] | undefined} [filesystems]
 */
export function platformModuleSchemaFor(filesystems) {
  const fs = nonEmptyFsTuple(filesystems)
  const filesystemsField = z.array(z.string().trim().min(1)).min(1).readonly()

  if (!fs) {
    return z.strictObject({
      id: z.string().trim().min(1),
      packages: platformPackagesMapSchemaFor(),
      installPackages: z.custom(
        (v) => typeof v === 'function',
        'installPackages must be a function',
      ),
      networking: platformNetworkingSchema,
      filesystems: filesystemsField.optional(),
      defaultFs: z.string().trim().min(1).optional(),
      osDisk: platformOsDiskSchema.optional(),
    })
  }

  return z.strictObject({
    id: z.string().trim().min(1),
    packages: platformPackagesMapSchemaFor(fs),
    installPackages: z.custom((v) => typeof v === 'function', 'installPackages must be a function'),
    networking: platformNetworkingSchema,
    filesystems: filesystemsField,
    defaultFs: z.enum(fs),
    osDisk: platformOsDiskSchema,
  })
}

/** Base module schema (no FS keys required on packages). Prefer {@link parsePlatformModule}. */
export const platformModuleSchema = platformModuleSchemaFor()

/**
 * Zod-validate a platform module (`z.input` → `z.infer` of {@link platformModuleSchema}).
 * When `filesystems` is set, parses with {@link platformModuleSchemaFor}.
 * Use from guest/host tooling; platform packages use {@link definePlatform} instead.
 *
 * @template {z.input<typeof platformModuleSchema>} T
 * @param {T} raw
 * @returns {z.infer<typeof platformModuleSchema>}
 */
export function parsePlatformModule(raw) {
  const filesystems = raw.filesystems
  const fsList = Array.isArray(filesystems) ? [...filesystems] : undefined
  const parsed = platformModuleSchemaFor(fsList).parse(raw)
  for (const [cap, recipe] of Object.entries(parsed.packages)) {
    for (const dep of recipe.needs || []) {
      if (!parsed.packages[dep]) {
        throw new Error(`platform packages[${cap}].needs: unknown capability ${dep}`)
      }
    }
  }

  /** @type {z.infer<typeof platformModuleSchema>} */
  const out = {
    ...parsed,
    ...(parsed.filesystems ? { filesystems: Object.freeze([...parsed.filesystems]) } : {}),
    ...(parsed.osDisk ? { osDisk: Object.freeze({ ...parsed.osDisk }) } : {}),
  }
  return out
}
