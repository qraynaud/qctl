/**
 * Resolve Rocky platform assets for the host:
 * - seed kit (embedded in qctl-host)
 * - cloud image pin (from `@qctl/platform-rocky` plugin after download)
 */
import { existsSync } from 'node:fs'

import { chalk, fs, path } from 'zx'

import { loadCloudImageFromPlugin, tryLoadCloudImageFromEnv } from '../cloud-image.js'
import { loadEnvSecretsOrThrow } from '../lib/load-config.js'
import { getTooling, isSeedKitRoot, setSeedKitRoot } from '../lib/paths.js'
import { die } from '../lib/util.js'
import { tryGetLocalGuestDist } from '../qctl-source.js'
import { copySeedKit } from '../seed-fs.js'
import { getRockySeedRoot, isEmbeddedSeedRoot } from '../seed-root.js'
import { touchPath } from './cache-gc.js'
import { downloadGithubReleaseAsset } from './github-release.js'
import { parsePlatformRef, resolvePlatformVersion } from './platform-ref.js'

/** @import { RockyCloudImage } from '../cloud-image.js' */
/** @import { PlatformRef } from './platform-ref.js' */

/**
 * Resolve seed-kit root, materializing an embedded (`$bunfs`) kit into XDG cache.
 * Always re-copies from the embed — a one-shot cache goes stale across host rebuilds
 * and silently ships the wrong cloud-init profile (e.g. appliance runcmd on init-tank).
 * @returns {Promise<string>}
 */
export async function ensurePlatformSeedKit() {
  const fromEnv = process.env.QCTL_ROCKY_SEED
  if (fromEnv && isSeedKitRoot(fromEnv)) {
    setSeedKitRoot(fromEnv)
    console.log(chalk.dim(`  seed kit: ${fromEnv} (QCTL_ROCKY_SEED)`))
    return fromEnv
  }

  let src
  try {
    src = getRockySeedRoot()
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }

  if (!isEmbeddedSeedRoot(src) && isSeedKitRoot(src)) {
    setSeedKitRoot(src)
    console.log(chalk.dim(`  seed kit: ${src}`))
    return src
  }

  const dest = path.join(getTooling(), 'host', 'seed')
  await fs.mkdirp(path.dirname(dest))
  console.log(chalk.cyan(`vm: materialize seed kit → ${dest}`))
  try {
    copySeedKit(src, dest)
  } catch (err) {
    die(
      `host seed-kit materialize failed.\n`
        + `  ${err instanceof Error ? err.message : String(err)}\n`
        + `  Need a qctl-host with embedded seed, or set QCTL_ROCKY_SEED.`,
    )
  }
  touchPath(path.join(dest, 'cloud-init', 'user-data.yaml'))

  setSeedKitRoot(dest)
  console.log(chalk.dim(`  seed kit: ${dest} ← host embed`))
  return dest
}

/**
 * Resolve `qctl.platform` from provision (default `rocky`).
 * @param {{ env?: string, target?: string, platform?: string }} [opts]
 * @returns {Promise<PlatformRef>}
 */
export async function resolvePlatformRef(opts = {}) {
  if (opts.platform != null && String(opts.platform).trim() !== '') {
    return parsePlatformRef(opts.platform)
  }
  try {
    const sec = await loadEnvSecretsOrThrow({
      env: opts.env || 'dev',
      target: opts.target || 'local',
    })
    return parsePlatformRef(sec.platform)
  } catch {
    return parsePlatformRef('rocky')
  }
}

/**
 * Local overrides + checkout `dist/` (never a random sibling tree).
 * Installed hosts fall through to the tooling cache / GitHub download.
 * @param {string} moduleFile
 * @returns {string[]}
 */
function platformModuleCandidates(moduleFile) {
  /** @type {string[]} */
  const out = []
  const fromEnv = process.env.QCTL_PLATFORM_MODULE?.trim()
  if (fromEnv) out.push(path.resolve(fromEnv))
  if (process.env.QCTL_GUEST_DIST?.trim()) {
    out.push(path.join(path.resolve(process.env.QCTL_GUEST_DIST), moduleFile))
  }
  const checkoutDist = tryGetLocalGuestDist()
  if (checkoutDist) out.push(path.join(checkoutDist, moduleFile))
  return out
}

/**
 * Ensure the selected platform ESM module is on disk (env override or GitHub download).
 * @param {{ env?: string, target?: string, version?: string, platform?: string, quiet?: boolean }} [opts]
 * @returns {Promise<string>} absolute path to the module
 */
export async function ensurePlatformModule(opts = {}) {
  const quiet = opts.quiet === true
  const ref = await resolvePlatformRef(opts)
  for (const p of platformModuleCandidates(ref.moduleFile)) {
    if (existsSync(p)) {
      if (!quiet) console.log(chalk.dim(`  platform plugin: ${p} (${ref.raw})`))
      return p
    }
  }

  const version = resolvePlatformVersion(ref, opts)
  const destDir = path.join(getTooling(), `platform-${ref.id}`, version)
  const dest = path.join(destDir, ref.moduleFile)
  if (existsSync(dest)) {
    touchPath(dest)
    if (!quiet) console.log(chalk.dim(`  platform plugin: ${dest}`))
    return dest
  }

  await downloadGithubReleaseAsset({
    githubRepo: ref.githubRepo,
    version,
    name: ref.moduleFile,
    dest,
  })
  touchPath(dest)
  return dest
}

/**
 * Resolve the cloud image pin from the selected platform plugin
 * (`CLOUD_IMAGE` via dynamic import). Optional `QCTL_ROCKY_CLOUD_IMAGE` JSON override.
 * @param {{ env?: string, target?: string, version?: string, platform?: string }} [opts]
 * @returns {Promise<RockyCloudImage>}
 */
export async function ensureCloudImage(opts = {}) {
  const fromEnv = tryLoadCloudImageFromEnv()
  if (fromEnv) {
    console.log(chalk.dim(`  cloud image pin: ${fromEnv.file} ← QCTL_ROCKY_CLOUD_IMAGE`))
    return fromEnv
  }

  const modPath = await ensurePlatformModule(opts)
  const pin = await loadCloudImageFromPlugin(modPath)
  console.log(chalk.dim(`  cloud image pin: ${pin.file} ← ${modPath}`))
  return pin
}
