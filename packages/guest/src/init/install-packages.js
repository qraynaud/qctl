/**
 * Resolve profile capabilities via the platform packages map, then install.
 * Distro → `platform.installPackages(string[])`; pipx → guest `installPipxPackages`.
 * Provision extras (packages.json) merge in; http stays seed `install-packages.sh`.
 */
import { existsSync } from 'node:fs'

import {
  installCapabilityPackages,
  normalizePackages,
  packagesForCapabilities,
  packagesIsEmpty,
} from '@qctl/shared'

import { capabilitiesForProfile } from './capabilities.js'
import { installPipxPackages } from './install-pipx.js'
import { loadPlatformModule } from './load-platform.js'

/** @import { InitProfile, NormalizedPackages, PlatformModule } from '@qctl/shared' */

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<NormalizedPackages | undefined>}
 */
async function loadExtraPackages(env) {
  const path = env.ROCKY_PACKAGES_JSON?.trim() || '/usr/local/lib/rocky/packages.json'
  if (!existsSync(path)) return undefined
  try {
    const raw = await Bun.file(path).json()
    const normalized = normalizePackages(raw)
    return packagesIsEmpty(normalized) ? undefined : normalized
  } catch (err) {
    throw new Error(`failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * @typedef {object} InstallInitPackagesOpts
 * @property {InitProfile} profile
 * @property {Record<string, string | undefined>} [env]
 * @property {(line: string) => void} [log]
 * @property {boolean} [dryRun]
 * @property {() => Promise<PlatformModule>} [loadPlatform]
 */

/**
 * @param {InstallInitPackagesOpts} opts
 * @returns {Promise<NormalizedPackages>}
 */
export async function installInitPackages(opts) {
  const env = opts.env ?? process.env
  const log = opts.log ?? ((l) => console.log(l))
  const platform = await (opts.loadPlatform ? opts.loadPlatform() : loadPlatformModule(env))
  const vcs = (env.ROCKY_REPO_VCS || env.QCTL_REPO_VCS || '').trim() || undefined
  const capabilities = capabilitiesForProfile(opts.profile, { vcs })
  const extra = opts.profile === 'default' ? await loadExtraPackages(env) : undefined

  if (opts.dryRun) {
    const manifest = packagesForCapabilities(platform.packages, capabilities, extra)
    log(
      `qctl init: packages (dry-run) capabilities=[${capabilities.join(', ')}] `
        + `distro=${manifest.distro.length} pipx=${manifest.pipx.length}`,
    )
    return manifest
  }

  log(
    `qctl init: installing platform packages (profile=${opts.profile}${vcs ? ` vcs=${vcs}` : ''})`,
  )
  const manifest = await installCapabilityPackages(platform, {
    capabilities,
    extra,
    install: { log, env },
  })
  await installPipxPackages(manifest.pipx, { log, env })
  return manifest
}
