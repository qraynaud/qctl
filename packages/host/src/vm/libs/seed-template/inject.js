/**
 * Post-render cloud-config write_files injectors (Tier-0, packages, provision files).
 */
import { isCloudInitYamlSafe, withTrailingNewline } from './util.js'

/** @import { YamlMapping, YamlValue } from '@qctl/shared' */
/** @import { NormalizedPackages } from '../../../provision/secrets-schema/packages.js' */

/** @typedef {YamlMapping} CloudConfig */
/**
 * @typedef {{
 *   path?: string,
 *   content?: YamlValue,
 *   encoding?: string,
 * } & YamlMapping} CloudWriteFile
 */

const TIER0_PENDING_PREFIX = '/var/lib/rocky/tier0-pending/'

/**
 * Plain text → trailing newline. Binary / control-heavy → base64 so PyYAML
 * (cloud-init) does not reject the whole user-data document.
 *
 * @param {string} value
 * @returns {Pick<CloudWriteFile, 'content' | 'encoding'>}
 */
function cloudInitFileContent(value) {
  const raw = String(value ?? '')
  if (isCloudInitYamlSafe(raw)) {
    return { content: withTrailingNewline(raw) }
  }
  return {
    encoding: 'base64',
    content: Buffer.from(raw, 'utf8').toString('base64'),
  }
}

/**
 * Embed every `@tag(guest)` value as a Tier-0 pending write_files entry
 * (`/var/lib/rocky/tier0-pending/<KEY>`). Replaces any prior entry for the same path.
 *
 * @param {CloudConfig} userData parsed cloud-config
 * @param {Record<string, string> | undefined} guest
 */
export function injectGuestCredentialFiles(userData, guest) {
  if (!userData || typeof userData !== 'object') return userData
  const entries = Object.entries(guest || {}).filter(([, v]) => v != null && String(v) !== '')
  if (!entries.length) return userData

  /** @type {CloudWriteFile[]} */
  const writeFiles = Array.isArray(userData.write_files)
    ? /** @type {CloudWriteFile[]} */ ([...userData.write_files])
    : []
  /** @type {Set<string | undefined>} */
  const drop = new Set(entries.map(([key]) => `${TIER0_PENDING_PREFIX}${key}`))
  const kept = writeFiles.filter((w) => !(w && typeof w === 'object' && drop.has(w.path)))
  for (const [key, value] of entries) {
    kept.push({
      path: `${TIER0_PENDING_PREFIX}${key}`,
      owner: 'root:root',
      permissions: '0400',
      ...cloudInitFileContent(value),
    })
  }
  userData.write_files = kept
  return userData
}

const PACKAGES_JSON_PATH = '/usr/local/lib/rocky/packages.json'

/**
 * Embed normalized `packages` (distro / pipx / http) for cloud-init
 * `install-packages.sh`.
 *
 * @param {CloudConfig} userData
 * @param {NormalizedPackages | undefined} packages
 */
export function injectPackagesManifest(userData, packages) {
  if (!userData || typeof userData !== 'object') return userData
  const body = {
    distro: packages?.distro || [],
    pipx: packages?.pipx || [],
    http: packages?.http || [],
  }
  /** @type {CloudWriteFile[]} */
  const writeFiles = Array.isArray(userData.write_files)
    ? /** @type {CloudWriteFile[]} */ ([...userData.write_files])
    : []
  const kept = writeFiles.filter(
    (w) => !(w && typeof w === 'object' && w.path === PACKAGES_JSON_PATH),
  )
  kept.push({
    path: PACKAGES_JSON_PATH,
    owner: 'root:root',
    permissions: '0644',
    content: `${JSON.stringify(body, null, 2)}\n`,
  })
  userData.write_files = kept
  return userData
}

/**
 * Merge provision `files:` into cloud-init `write_files` (replaces same path).
 * Ensures content ends with a newline.
 *
 * @param {CloudConfig} userData
 * @param {{ path: string, owner?: string, permissions?: string, content: string }[] | undefined} files
 */
export function injectProvisionFiles(userData, files) {
  if (!userData || typeof userData !== 'object') return userData
  const list = Array.isArray(files) ? files : []
  if (!list.length) return userData

  /** @type {CloudWriteFile[]} */
  const writeFiles = Array.isArray(userData.write_files)
    ? /** @type {CloudWriteFile[]} */ ([...userData.write_files])
    : []
  /** @type {Set<string | undefined>} */
  const drop = new Set(list.map((f) => f.path).filter(Boolean))
  const kept = writeFiles.filter((w) => !(w && typeof w === 'object' && drop.has(w.path)))
  for (const f of list) {
    if (!f?.path) continue
    const body = String(f.content ?? '')
    kept.push({
      path: f.path,
      owner: f.owner || 'root:root',
      permissions: f.permissions || '0644',
      content: body.endsWith('\n') ? body : `${body}\n`,
    })
  }
  userData.write_files = kept
  return userData
}
