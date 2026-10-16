/**
 * Host-side seed profile helpers (packages + VCS defaults).
 */
import { applyVcsFileDefaults } from '../../../provision/schema/files.js'
import { applyVcsPackageDefaults } from '../../../provision/schema/packages.js'

/** @import { LoadedProvision } from '../../../lib/load-config-types.js' */
/** @import { GuestFile } from '../../../provision/schema/files.js' */
/** @import { NormalizedPackages } from '../../../provision/schema/packages.js' */
/** @import { SeedProfile as VmSeedProfile } from '../../types.js' */

/** @typedef {VmSeedProfile} SeedProfile */

/** Profile templates (paths resolved per env via resolveSeedPaths). */
export const SEED_PROFILES = {
  appliance: {
    userData: 'user-data.yaml',
  },
  'init-tank': {
    // Same cloud-init template as appliance; `profile` Nunjucks switches the deltas.
    userData: 'user-data.yaml',
  },
}

/**
 * Packages embedded for a seed profile.
 * User `packages.pipx` / `http` / `distro` always apply (e.g. `bw` for vw plugins).
 * Auto mercurial+hg-evolve only for appliance (`vm up`) when `repo.vcs: hg`.
 *
 * @param {SeedProfile | string} profileName
 * @param {NormalizedPackages | undefined} packages
 * @param {string | undefined | null} vcs
 * @returns {NormalizedPackages}
 */
export function packagesForSeedProfile(profileName, packages, vcs) {
  const base = {
    distro: [...(packages?.distro || [])],
    pipx: [...(packages?.pipx || [])],
    http: [...(packages?.http || [])],
  }
  if (profileName === 'init-tank') return base
  return applyVcsPackageDefaults(base, vcs)
}

/**
 * Provision `files:` for a seed profile. Stock `/etc/mercurial/hgrc` only on appliance + hg.
 *
 * @param {SeedProfile | string} profileName
 * @param {GuestFile[] | undefined} files
 * @param {string | undefined | null} vcs
 * @returns {GuestFile[]}
 */
export function filesForSeedProfile(profileName, files, vcs) {
  const base = [...(files || [])]
  if (profileName === 'init-tank') return base
  return applyVcsFileDefaults(base, vcs)
}

/**
 * @param {LoadedProvision} sec
 * @param {SeedProfile | string} profileName
 * @returns {LoadedProvision}
 */
export function applySeedProfileDefaults(sec, profileName) {
  const vcs = sec.data?.repo?.vcs === 'hg' ? 'hg' : 'git'
  return {
    ...sec,
    packages: packagesForSeedProfile(profileName, sec.packages, vcs),
    files: filesForSeedProfile(profileName, sec.files, vcs),
  }
}
