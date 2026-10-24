/**
 * Resolve profile capabilities via the platform packages map, then install.
 * Distro → `platform.installPackages(string[])`; pipx / http → guest helpers.
 * Provision extras (`seed.packages`) merge in for every profile.
 * Storage caps (`xfs` / `ext4` / `zfs`) come from seed disks.
 */
import { installCapabilityPackages, packagesForCapabilities, packagesIsEmpty } from '@qctl/shared'

import { capabilitiesForProfile } from './capabilities.js'
import { disksPackageHintsFrom } from './disks-json.js'
import { installHttpPackages } from './install-http.js'
import { installPipxPackages } from './install-pipx.js'
import { loadPlatformModule } from './load-platform.js'

/** @import { InitProfile, NormalizedPackages, PlatformModule, SeedConfig } from '@qctl/shared' */

/**
 * @typedef {object} InstallInitPackagesOpts
 * @property {InitProfile} profile
 * @property {Record<string, string | undefined>} [env] Spawn env for package installers only.
 * @property {(line: string) => void} [log]
 * @property {boolean} [dryRun]
 * @property {() => Promise<PlatformModule>} [loadPlatform]
 * @property {SeedConfig} [seedConfig]
 */

/**
 * @param {InstallInitPackagesOpts} opts
 * @returns {Promise<NormalizedPackages>}
 */
export async function installInitPackages(opts) {
  const env = opts.env ?? process.env
  const log = opts.log ?? ((l) => console.log(l))
  const seed = opts.seedConfig
  const platform = await (opts.loadPlatform ? opts.loadPlatform() : loadPlatformModule(env))
  const vcs = seed?.repo?.vcs
  const disks = disksPackageHintsFrom(seed?.disks)
  if (!disks) {
    log(`qctl _internal_init: no seed disks — skipping storage package capabilities (fs/zfs)`)
  }
  const capabilities = capabilitiesForProfile(opts.profile, { vcs, disks })
  const extra = seed?.packages && !packagesIsEmpty(seed.packages) ? seed.packages : undefined

  if (opts.dryRun) {
    const manifest = packagesForCapabilities(platform.packages, capabilities, extra)
    log(
      `qctl _internal_init: packages (dry-run) capabilities=[${capabilities.join(', ')}] `
        + `distro=${manifest.distro.length} pipx=${manifest.pipx.length} `
        + `http=${manifest.http.length}`,
    )
    return manifest
  }

  log(
    `qctl _internal_init: installing platform packages (profile=${opts.profile}${vcs ? ` vcs=${vcs}` : ''})`,
  )
  // Appliance OS upgrade runs in cloud-init runcmd *before* rocky-first-boot
  // (upgrading systemd under a waited oneshot resets D-Bus / fails scripts_user).
  // Here we only install capability packages.
  const manifest = await installCapabilityPackages(platform, {
    capabilities,
    extra,
    install: {
      log,
      env,
      upgrade: false,
    },
  })
  await installPipxPackages(manifest.pipx, { log, env })
  await installHttpPackages(manifest.http, { log, env })
  return manifest
}
