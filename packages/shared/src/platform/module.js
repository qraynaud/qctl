/**
 * Platform module contract: every `@qctl/platform-*` package must export this shape.
 *
 * `packages` is an open map (capability name → recipe). Guest picks capability names
 * and resolves them through this map. Recipes may declare `distro` and/or `pipx`;
 * `installPackages(string[])` only installs distro names — guest installs pipx itself.
 */
import { z } from 'zod'

import {
  emptyPackages,
  mergePackages,
  normalizePackages,
  packagesPipxItemSchema,
} from '../packages/manifest.js'

/** @import { NormalizedPackages } from '../packages/manifest.js' */

/**
 * @typedef {object} PlatformCapabilityRecipe
 * @property {string[]} [needs] Other capability keys in the same map
 * @property {string[]} [distro] Distro package names (dnf/apt/…)
 * @property {Array<string | { package: string, inject?: string[] }>} [pipx]
 */

/**
 * @typedef {Record<string, PlatformCapabilityRecipe>} PlatformPackagesMap
 */

/**
 * @typedef {object} PlatformInstallOpts
 * @property {(line: string) => void} [log]
 * @property {Record<string, string | undefined>} [env]
 */

/**
 * Guest-side networking hooks (OS-specific). Host never imports these —
 * the guest loads the staged platform module and calls them from init stages.
 *
 * @typedef {object} PlatformNetworkCtx
 * @property {Record<string, string | undefined>} env
 * @property {(line: string) => void} log
 * @property {(argv: string[]) => Promise<{ code: number, stdout: string, stderr: string }>} exec
 */

/**
 * @typedef {object} PlatformNetworking
 * @property {(ctx: PlatformNetworkCtx) => string[]} [planEnsureUp]
 * @property {(ctx: PlatformNetworkCtx) => Promise<void>} [ensureUp]
 * @property {(ctx: PlatformNetworkCtx) => string[]} [planApplyDnat]
 * @property {(ctx: PlatformNetworkCtx) => Promise<void>} [applyDnat]
 */

/**
 * @typedef {object} PlatformModule
 * @property {string} id  e.g. `rocky`
 * @property {PlatformPackagesMap} packages
 * @property {(packages: string[], opts?: PlatformInstallOpts) => Promise<void>} installPackages
 * @property {PlatformNetworking} [networking]
 */

const pkgName = z.string().trim().min(1)
const capName = z.string().trim().min(1)

export const platformCapabilityRecipeSchema = z
  .object({
    needs: z.array(capName).optional(),
    distro: z.array(pkgName).optional(),
    pipx: z.array(packagesPipxItemSchema).optional(),
  })
  .strict()

export const platformPackagesMapSchema = z.record(capName, platformCapabilityRecipeSchema)

const platformNetworkingSchema = z
  .object({
    planEnsureUp: z.custom((v) => v === undefined || typeof v === 'function').optional(),
    ensureUp: z.custom((v) => v === undefined || typeof v === 'function').optional(),
    planApplyDnat: z.custom((v) => v === undefined || typeof v === 'function').optional(),
    applyDnat: z.custom((v) => v === undefined || typeof v === 'function').optional(),
  })
  .strict()
  .optional()

export const platformModuleSchema = z
  .object({
    id: z.string().trim().min(1),
    packages: platformPackagesMapSchema,
    installPackages: z.custom((v) => typeof v === 'function', 'installPackages must be a function'),
    networking: platformNetworkingSchema,
  })
  .strict()

/**
 * Validate a platform module (throws ZodError on failure).
 * @param {z.input<typeof platformModuleSchema>} raw
 * @returns {PlatformModule}
 */
export function definePlatform(raw) {
  const parsed = platformModuleSchema.parse(raw)
  const packages = /** @type {PlatformPackagesMap} */ (parsed.packages)
  for (const [cap, recipe] of Object.entries(packages)) {
    for (const dep of recipe.needs || []) {
      if (!packages[dep]) {
        throw new Error(`platform packages[${cap}].needs: unknown capability ${dep}`)
      }
    }
  }
  return {
    id: parsed.id,
    packages,
    installPackages: /** @type {PlatformModule['installPackages']} */ (parsed.installPackages),
    ...(parsed.networking
      ? { networking: /** @type {PlatformNetworking} */ (parsed.networking) }
      : {}),
  }
}

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
  if (manifest.distro.length === 0 && manifest.pipx.length === 0) {
    opts.install?.log?.('platform packages: nothing to install')
    return manifest
  }
  if (manifest.distro.length > 0) {
    await platform.installPackages(manifest.distro, opts.install)
  }
  return manifest
}
