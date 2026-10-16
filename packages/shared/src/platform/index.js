/**
 * Platform module contract: every `@qctl/platform-*` package must export this shape.
 *
 * - Authoring (no Zod): {@link definePackagesMap}, {@link definePlatform}
 * - Guest/host Zod: {@link parsePlatformModule}, {@link platformModuleSchemaFor}
 *
 * Types: {@link ./platform-types.ts}
 */
import { emptyPackages, mergePackages, normalizePackages } from '../packages/manifest.js'

/** @import { NormalizedPackages } from '../packages/manifest.js' */
/**
 * @import {
 *   PlatformInstallOpts,
 *   PlatformModule,
 *   PlatformPackagesMap,
 * } from './platform-types.js'
 */

export { definePackagesMap, definePlatform, packagesMapWithRequired } from './define.js'
export {
  parsePlatformModule,
  platformCapabilityRecipeSchema,
  platformModuleSchema,
  platformModuleSchemaFor,
  platformPackagesMapSchema,
  platformPackagesMapSchemaFor,
  requiredPlatformCapabilitySchema,
} from './schema.js'

/**
 * Expand requested capabilities through `needs` edges (topo order, cycle-safe).
 * @param {PlatformPackagesMap} map
 * @param {Iterable<string>} wanted
 * @returns {string[]}
 */
export function expandCapabilities(map, wanted) {
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  const visiting = new Set()

  /**
   * @param {string} cap
   */
  function visit(cap) {
    if (seen.has(cap)) return
    if (visiting.has(cap)) {
      throw new Error(`platform capability cycle involving ${cap}`)
    }
    const recipe = map[cap]
    if (!recipe) throw new Error(`platform packages map missing capability ${cap}`)
    visiting.add(cap)
    for (const dep of recipe.needs || []) visit(dep)
    visiting.delete(cap)
    seen.add(cap)
    out.push(cap)
  }

  for (const w of wanted) visit(String(w).trim())
  return out
}

/**
 * Merge capability recipes (+ optional provision extras) into a normalized manifest.
 * @param {PlatformPackagesMap} map
 * @param {Iterable<string>} wanted
 * @param {NormalizedPackages | undefined} [extra]
 * @returns {NormalizedPackages}
 */
export function packagesForCapabilities(map, wanted, extra) {
  const caps = expandCapabilities(map, wanted)
  const parts = caps.map((c) =>
    normalizePackages({
      distro: map[c].distro,
      pipx: map[c].pipx,
    }),
  )
  if (extra) parts.push(extra)
  return parts.length === 0 ? emptyPackages() : mergePackages(...parts)
}

/**
 * Distro package names only (for `platform.installPackages`).
 * @param {PlatformPackagesMap} map
 * @param {Iterable<string>} wanted
 * @param {Iterable<string> | undefined} [extra]
 * @returns {string[]}
 */
export function distroPackagesForCapabilities(map, wanted, extra) {
  const extraManifest = extra ? normalizePackages({ distro: [...extra] }) : undefined
  return packagesForCapabilities(map, wanted, extraManifest).distro
}

/**
 * @typedef {object} InstallCapabilityPackagesOpts
 * @property {Iterable<string>} capabilities
 * @property {NormalizedPackages} [extra]
 * @property {PlatformInstallOpts} [install]
 */

/**
 * Resolve capabilities → distro install via platform (`installPackages`).
 * Caller installs `packages.pipx` separately when needed.
 * @param {PlatformModule} platform
 * @param {InstallCapabilityPackagesOpts} opts
 * @returns {Promise<NormalizedPackages>}
 */
export async function installCapabilityPackages(platform, opts) {
  const manifest = packagesForCapabilities(platform.packages, opts.capabilities, opts.extra)
  if (manifest.distro.length === 0 && manifest.pipx.length === 0 && manifest.http.length === 0) {
    opts.install?.log?.('platform packages: nothing to install')
    return manifest
  }
  if (manifest.distro.length > 0) {
    await platform.installPackages(manifest.distro, opts.install)
  }
  return manifest
}
