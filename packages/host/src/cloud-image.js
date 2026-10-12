/**
 * Cloud image pin from a platform plugin (`CLOUD_IMAGE` export).
 *
 * Prefer {@link ensureCloudImage} (platform-tooling): resolve
 * `qctl-platform-*.mjs` then dynamic `import()`. Optional override:
 * `QCTL_ROCKY_CLOUD_IMAGE` → path to a JSON pin of the same shape.
 *
 * Sync {@link IMAGE} / {@link loadCloudImage} only work after the pin is
 * cached (ensureCloudImage / loadCloudImageFromPlugin / env override).
 */
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * @typedef {object} RockyCloudImage
 * @property {string} file
 * @property {string} url
 * @property {string} sha256
 */

/**
 * Pre-validation pin shape (JSON / plugin export before normalize).
 * @typedef {object} CloudImagePinCandidate
 * @property {string} [file]
 * @property {string} [url]
 * @property {string} [sha256]
 */

/** @type {RockyCloudImage | null} */
let cached = null

/**
 * @param {CloudImagePinCandidate | RockyCloudImage | null | undefined} raw
 * @param {string} label
 * @returns {RockyCloudImage}
 */
export function normalizeCloudImage(raw, label = 'cloud image pin') {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`invalid ${label}`)
  }
  const file = typeof raw.file === 'string' ? raw.file.trim() : ''
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  const sha256 = typeof raw.sha256 === 'string' ? raw.sha256.trim().toLowerCase() : ''
  if (!file || !url || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`invalid ${label} (need file, url, sha256 hex)`)
  }
  return { file, url, sha256 }
}

/**
 * @param {string} filePath
 * @returns {RockyCloudImage}
 */
export function readCloudImagePinFile(filePath) {
  /** @type {CloudImagePinCandidate} */
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  return normalizeCloudImage(parsed, filePath)
}

/**
 * Load pin from `QCTL_ROCKY_CLOUD_IMAGE` when set and readable.
 * @returns {RockyCloudImage | null}
 */
export function tryLoadCloudImageFromEnv() {
  const fromEnv = process.env.QCTL_ROCKY_CLOUD_IMAGE?.trim()
  if (!fromEnv || !existsSync(fromEnv)) return null
  return setCloudImageCache(readCloudImagePinFile(fromEnv))
}

/**
 * Cached pin after {@link ensureCloudImage} / {@link loadCloudImageFromPlugin}.
 * @returns {RockyCloudImage}
 */
export function loadCloudImage() {
  if (cached) return cached
  const fromEnv = tryLoadCloudImageFromEnv()
  if (fromEnv) return fromEnv
  throw new Error(
    'cloud image pin not loaded — call ensureCloudImage() (imports qctl-platform-*.mjs CLOUD_IMAGE),\n'
      + '  or set QCTL_ROCKY_CLOUD_IMAGE to a JSON pin file.',
  )
}

/**
 * @param {RockyCloudImage} pin
 * @returns {RockyCloudImage}
 */
export function setCloudImageCache(pin) {
  cached = normalizeCloudImage(pin)
  return cached
}

/** Clear memoized pin (tests). */
export function resetCloudImageCache() {
  cached = null
}

/**
 * Load `CLOUD_IMAGE` from a platform plugin module path.
 * @param {string} modulePath
 * @returns {Promise<RockyCloudImage>}
 */
export async function loadCloudImageFromPlugin(modulePath) {
  /** @type {{ CLOUD_IMAGE?: CloudImagePinCandidate | RockyCloudImage }} */
  const mod = await import(pathToFileURL(modulePath).href)
  return setCloudImageCache(normalizeCloudImage(mod.CLOUD_IMAGE, modulePath))
}

/**
 * Lazy accessors so callers can keep `IMAGE.file` after {@link ensureCloudImage}.
 * @type {RockyCloudImage}
 */
export const IMAGE = {
  get file() {
    return loadCloudImage().file
  },
  get url() {
    return loadCloudImage().url
  },
  get sha256() {
    return loadCloudImage().sha256
  },
}
