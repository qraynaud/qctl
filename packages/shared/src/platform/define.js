/**
 * Platform authoring helpers (no Zod). Platforms call these at module load;
 * guest/host tooling validates with Zod via {@link ./schema.js} `parsePlatformModule`.
 */
import { REQUIRED_PLATFORM_CAPABILITIES } from './required-capabilities.js'

/**
 * @import {
 *   PlatformCapabilityRecipe,
 *   PlatformModule,
 *   PlatformPackagesMap,
 * } from './platform-types.js'
 */

/**
 * Freeze a capability → recipe map. Requires every
 * {@link REQUIRED_PLATFORM_CAPABILITIES} key (empty recipe allowed).
 * Pass a fresh object literal so checkJs/TS keeps a narrow key type (no `as const`).
 *
 * @template {PlatformPackagesMap} M
 * @param {M} map
 * @returns {Readonly<M>}
 */
export function definePackagesMap(map) {
  if (map == null || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error('definePackagesMap: expected a packages object')
  }
  for (const cap of REQUIRED_PLATFORM_CAPABILITIES) {
    if (!Object.hasOwn(map, cap)) {
      throw new Error(
        `definePackagesMap: packages map must include capability ${JSON.stringify(cap)}`,
      )
    }
  }
  return Object.freeze(map)
}

/**
 * Build a packages map with empty recipes for every required capability,
 * then apply overrides. Useful for tests and incomplete prototypes.
 *
 * @param {Record<string, PlatformCapabilityRecipe>} [over]
 * @returns {Readonly<PlatformPackagesMap>}
 */
export function packagesMapWithRequired(over = {}) {
  return definePackagesMap(
    /** @type {PlatformPackagesMap} */ ({
      ...Object.fromEntries(REQUIRED_PLATFORM_CAPABILITIES.map((c) => [c, {}])),
      ...over,
    }),
  )
}

/**
 * Type-narrowing / freeze helper for platform modules (no Zod).
 * When `filesystems` is set, requires `defaultFs` ∈ filesystems, `osDisk`, and a
 * packages key per FS name. Guest/host should call `parsePlatformModule` (Zod).
 *
 * @template {PlatformModule} T
 * @param {T} raw
 * @returns {Readonly<T>}
 */
export function definePlatform(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('definePlatform: expected a platform object')
  }
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    throw new Error('definePlatform: id is required')
  }
  if (typeof raw.installPackages !== 'function') {
    throw new Error('definePlatform: installPackages must be a function')
  }
  if (raw.packages == null || typeof raw.packages !== 'object' || Array.isArray(raw.packages)) {
    throw new Error('definePlatform: packages map is required')
  }

  for (const cap of REQUIRED_PLATFORM_CAPABILITIES) {
    if (!Object.hasOwn(raw.packages, cap)) {
      throw new Error(`definePlatform: packages map must include capability ${JSON.stringify(cap)}`)
    }
  }

  const filesystems = raw.filesystems
  if (filesystems != null) {
    if (!Array.isArray(filesystems) || filesystems.length === 0) {
      throw new Error('definePlatform: filesystems must be a non-empty array when set')
    }
    if (raw.defaultFs == null || !filesystems.includes(raw.defaultFs)) {
      throw new Error('definePlatform: defaultFs must be listed in filesystems')
    }
    if (raw.osDisk == null || typeof raw.osDisk !== 'object') {
      throw new Error('definePlatform: osDisk is required when filesystems is set')
    }
    for (const fs of filesystems) {
      if (!Object.hasOwn(raw.packages, fs)) {
        throw new Error(
          `definePlatform: packages must include filesystem capability ${JSON.stringify(fs)}`,
        )
      }
    }
  }

  for (const [cap, recipe] of Object.entries(raw.packages)) {
    for (const dep of recipe.needs || []) {
      if (!raw.packages[dep]) {
        throw new Error(`platform packages[${cap}].needs: unknown capability ${dep}`)
      }
    }
  }

  return Object.freeze({
    ...raw,
    ...(raw.filesystems ? { filesystems: Object.freeze([...raw.filesystems]) } : {}),
    ...(raw.osDisk ? { osDisk: Object.freeze({ ...raw.osDisk }) } : {}),
  })
}
