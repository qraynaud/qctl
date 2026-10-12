/**
 * Parse `qctl.platform` selection refs.
 *
 * Supported forms:
 *   - `rocky`                         short name (built-in alias)
 *   - `rocky@0.1.0` / `rocky@v0.1.0`  short name + optional version skew
 *   - `github:owner/repo`
 *   - `github:owner/repo@0.1.0`
 *
 * Version omitted → use the running host version (`QCTL_VERSION`).
 */
import { QCTL_VERSION } from '@qctl/shared'

/**
 * @typedef {object} PlatformRef
 * @property {string} id Short id (`rocky`, `ubuntu`) — module basename stem
 * @property {string} githubRepo `owner/repo`
 * @property {string | null} versionPin Semver without leading `v`, or null = host version
 * @property {string} moduleFile e.g. `qctl-platform-rocky.mjs`
 * @property {string} raw Original provision string
 */

/** @type {Record<string, { githubRepo: string }>} */
export const PLATFORM_SHORT_ALIASES = {
  rocky: { githubRepo: 'qraynaud/qctl' },
}

const SEMVER = '([0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)'

/**
 * @param {string} repo `owner/repo`
 * @returns {string}
 */
export function platformIdFromGithubRepo(repo) {
  const name = String(repo).split('/')[1] || String(repo)
  if (name.startsWith('platform-')) return name.slice('platform-'.length)
  if (name.startsWith('qctl-platform-')) return name.slice('qctl-platform-'.length)
  return name
}

/**
 * @param {string | undefined | null} raw
 * @returns {PlatformRef}
 */
export function parsePlatformRef(raw) {
  const t = String(raw ?? 'rocky').trim() || 'rocky'

  const gh = t.match(new RegExp(`^github:([^/@]+/[^/@]+)(?:@v?${SEMVER})?$`, 'i'))
  if (gh) {
    const githubRepo = gh[1]
    const id = platformIdFromGithubRepo(githubRepo)
    if (!id || !/^[a-z][a-z0-9-]*$/i.test(id)) {
      throw new Error(`qctl.platform: cannot derive platform id from github:${githubRepo}`)
    }
    return {
      id: id.toLowerCase(),
      githubRepo,
      versionPin: gh[2] || null,
      moduleFile: `qctl-platform-${id.toLowerCase()}.mjs`,
      raw: t,
    }
  }

  const short = t.match(new RegExp(`^([a-z][a-z0-9-]*)(?:@v?${SEMVER})?$`, 'i'))
  if (short) {
    const id = short[1].toLowerCase()
    const alias = PLATFORM_SHORT_ALIASES[id]
    if (!alias) {
      throw new Error(
        `qctl.platform: unknown short name '${id}'.\n`
          + `  Use a known alias (${Object.keys(PLATFORM_SHORT_ALIASES).join(', ')})`
          + ` or github:owner/repo.`,
      )
    }
    return {
      id,
      githubRepo: process.env.QCTL_GITHUB_REPO?.trim() || alias.githubRepo,
      versionPin: short[2] || null,
      moduleFile: `qctl-platform-${id}.mjs`,
      raw: t,
    }
  }

  throw new Error(
    `qctl.platform: invalid ref '${t}'.\n`
      + '  Expected `rocky`, `rocky@x.y.z`, or `github:owner/repo[@x.y.z]`.',
  )
}

/**
 * Effective release version (no leading `v`).
 * @param {PlatformRef} ref
 * @param {{ version?: string }} [opts]
 * @returns {string}
 */
export function resolvePlatformVersion(ref, opts = {}) {
  const fromOpt = opts.version?.trim()
  if (fromOpt) return fromOpt.replace(/^v/, '')

  const fromEnv = process.env.QCTL_PLATFORM_VERSION?.trim()
  if (fromEnv) return fromEnv.replace(/^v/, '')

  if (ref.versionPin) return ref.versionPin

  return String(QCTL_VERSION).replace(/^v/, '')
}
