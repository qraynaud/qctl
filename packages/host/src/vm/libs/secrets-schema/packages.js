import { z } from 'zod'

import {
  MERCURIAL_PIPX_DEFAULT,
  normalizePackages as normalizePackagesShared,
  packagesHttpItemSchema,
  packagesPipxItemSchema,
} from '@qctl/shared'

/** @import { NormalizedPackages as SharedNormalizedPackages } from '@qctl/shared' */

export { packagesHttpItemSchema, packagesPipxItemSchema }

/** Re-export pin used by seed tests / cloud-init packages.json. */
export const HG_PIPX_DEFAULT = MERCURIAL_PIPX_DEFAULT

const pkgName = z.string().trim().min(1)

/** @typedef {SharedNormalizedPackages} NormalizedPackages */

export const packagesSchema = z
  .object({
    distro: z.array(pkgName).optional(),
    pipx: z.array(packagesPipxItemSchema).optional(),
    http: z.array(packagesHttpItemSchema).optional(),
  })
  .passthrough()

/**
 * Normalize packages block for seed / cloud-init.
 * @param {z.infer<typeof packagesSchema> | null | undefined} raw
 * @returns {NormalizedPackages}
 */
export function normalizePackages(raw) {
  return normalizePackagesShared(raw)
}

/**
 * Ensure VCS tooling is present in `packages` (idempotent).
 * Today: `repo.vcs === "hg"` → prepend mercurial+hg-evolve to `packages.pipx`
 * unless a mercurial entry is already listed (user pin wins).
 * Called from appliance seed (`vm up`) only — not init-tank.
 *
 * @param {NormalizedPackages} packages
 * @param {string | undefined | null} vcs
 * @returns {NormalizedPackages}
 */
export function applyVcsPackageDefaults(packages, vcs) {
  const out = {
    distro: [...(packages?.distro || [])],
    pipx: [...(packages?.pipx || [])],
    http: [...(packages?.http || [])],
  }
  if (vcs === 'hg') {
    const hasHg = out.pipx.some((p) => {
      const name = String(p.package || '')
        .split(/[<=>!~]/)[0]
        ?.trim()
      return name === 'mercurial'
    })
    if (!hasHg) {
      out.pipx = [
        { package: HG_PIPX_DEFAULT.package, inject: [...HG_PIPX_DEFAULT.inject] },
        ...out.pipx,
      ]
    }
  }
  return out
}
