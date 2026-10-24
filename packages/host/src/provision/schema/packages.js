import { z } from 'zod'

import { MERCURIAL_PIPX_DEFAULT, packagesManifestSchema } from '@qctl/shared'

/** @import { NormalizedPackages as SharedNormalizedPackages } from '@qctl/shared' */

/** Re-export pin used by seed tests / cloud-init packages.json. */
export const HG_PIPX_DEFAULT = MERCURIAL_PIPX_DEFAULT

/** @typedef {SharedNormalizedPackages} NormalizedPackages */

/** Provision `packages:` → normalized via shared {@link packagesManifestSchema}. */
export const packagesSchema = packagesManifestSchema

/** YAML `null` → omit, then {@link packagesSchema} prefault. */
export const packagesFieldSchema = z
  .unknown()
  .optional()
  .transform((v) => (v == null ? undefined : v))
  .pipe(packagesSchema)

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
