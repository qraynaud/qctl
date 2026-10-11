/**
 * Resolve guest + platform release assets.
 *
 * Order: `QCTL_GUEST_DIST` → local checkout `dist/` → GitHub release.
 * Release asset names (see `.github/workflows/release.yml`):
 *   qctl-guest, qctl-platform-<id>.mjs, varlock-local-encrypt
 */
import { existsSync } from 'node:fs'

import { chalk, fs, path } from 'zx'

import { tryGetLocalGuestDist } from '../../qctl-source.js'
import { touchPath } from './cache-gc.js'
import { downloadGithubReleaseAsset } from './github-release.js'
import { getTooling } from './paths.js'
import { parsePlatformRef, resolvePlatformVersion } from './platform-ref.js'
import { ensurePlatformModule, resolvePlatformRef } from './platform-tooling.js'
import { die } from './util.js'

/**
 * @typedef {object} GuestToolingResolved
 * @property {string} guestPath
 * @property {string} platformModulePath
 * @property {string | null} encryptPath
 * @property {string} platformModule
 * @property {string} sourceLabel
 */

/**
 * Download (or reuse cache) a same-release binary into the tooling cache.
 * @param {{
 *   githubRepo: string,
 *   version: string,
 *   name: string,
 *   mode?: number,
 *   required?: boolean,
 * }} opts
 * @returns {Promise<string | null>}
 */
async function ensureReleaseBinary(opts) {
  const destDir = path.join(getTooling(), 'guest', opts.version)
  const dest = path.join(destDir, opts.name)
  if (existsSync(dest)) {
    touchPath(dest)
    return dest
  }
  const got = await downloadGithubReleaseAsset({
    githubRepo: opts.githubRepo,
    version: opts.version,
    name: opts.name,
    dest,
    required: opts.required,
  })
  if (!got) return null
  if (opts.mode != null) await fs.chmod(got, opts.mode)
  touchPath(got)
  return got
}

/**
 * Ensure `qctl-guest`, platform module, and optional `varlock-local-encrypt`.
 *
 * Prefer local files when `QCTL_GUEST_DIST` is set or the host is running from a
 * qctl checkout (`dist/`). Otherwise download GitHub release assets for
 * `qctl.platform` / the host version.
 *
 * @param {{
 *   env?: string,
 *   target?: string,
 *   version?: string,
 *   platform?: string,
 *   platformModule?: string,
 *   required?: boolean,
 * }} [opts]
 * @returns {Promise<GuestToolingResolved | null>}
 */
export async function ensureGuestTooling(opts = {}) {
  const ref = opts.platform
    ? parsePlatformRef(opts.platform)
    : await resolvePlatformRef({ env: opts.env, target: opts.target, platform: opts.platform })
  const platformModule = opts.platformModule || ref.moduleFile
  const version = resolvePlatformVersion(ref, opts)

  const envDist = process.env.QCTL_GUEST_DIST?.trim()
  const checkoutDist = envDist ? null : tryGetLocalGuestDist()
  const distDir = envDist ? path.resolve(envDist) : checkoutDist
  const distKind = envDist ? 'QCTL_GUEST_DIST' : checkoutDist ? 'local checkout' : null

  /** @type {string | null} */
  let guestPath = null
  /** @type {string | null} */
  let encryptPath = null
  /** @type {string} */
  let sourceLabel = `github:${ref.githubRepo}@v${version}`

  if (distDir) {
    const localGuest = path.join(distDir, 'qctl-guest')
    if (existsSync(localGuest)) {
      guestPath = localGuest
      sourceLabel = distKind === 'local checkout' ? `${distDir} (${distKind})` : distDir
      const localEncrypt = path.join(distDir, 'varlock-local-encrypt')
      if (existsSync(localEncrypt)) encryptPath = localEncrypt
    } else if (opts.required === false) {
      console.log(chalk.dim(`  guest tooling: none found under ${distKind}=${distDir}`))
      return null
    } else if (distKind === 'QCTL_GUEST_DIST') {
      die(`QCTL_GUEST_DIST=${distDir} missing qctl-guest`)
    } else {
      die(
        `local qctl checkout missing ${path.join(distDir, 'qctl-guest')}\n`
          + '  Run `bun run compile` in the qctl repo (or set QCTL_GUEST_DIST).',
      )
    }
  } else {
    guestPath = await ensureReleaseBinary({
      githubRepo: ref.githubRepo,
      version,
      name: 'qctl-guest',
      mode: 0o755,
    })
    if (!guestPath) {
      die(`failed to resolve qctl-guest for github:${ref.githubRepo}@v${version}`)
    }
    encryptPath = await ensureReleaseBinary({
      githubRepo: ref.githubRepo,
      version,
      name: 'varlock-local-encrypt',
      mode: 0o755,
      required: false,
    })
    if (!encryptPath) {
      console.log(
        chalk.dim('  note: varlock-local-encrypt not on release — seed continues without it'),
      )
    }
  }

  const platformModulePath = await ensurePlatformModule({
    env: opts.env,
    target: opts.target,
    version: opts.version || version,
    platform: opts.platform || ref.raw,
  })

  console.log(chalk.dim(`  guest tooling: ← ${sourceLabel}`))
  return {
    guestPath,
    platformModulePath,
    encryptPath,
    platformModule,
    sourceLabel,
  }
}
