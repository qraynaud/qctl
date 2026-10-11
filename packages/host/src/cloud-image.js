/**
 * Rocky cloud image pin from `@qctl/platform-rocky` (no package dependency).
 *
 * Resolution order (sync):
 *   1. `QCTL_ROCKY_CLOUD_IMAGE` (path to JSON)
 *   2. Monorepo sibling `packages/platform-rocky/cloud-image.json`
 *   3. Checkout next to compiled `dist/qctl-host`
 *   4. `dist/cloud-image.json` / tooling cache next to downloaded platform plugin
 *
 * Outside a workspace, call {@link ensureCloudImage} so host can download
 * `qctl-platform-rocky.mjs` and read `CLOUD_IMAGE` from the plugin.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
 * @returns {string}
 */
export function workspaceCloudImagePath() {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'platform-rocky',
    'cloud-image.json',
  )
}

/**
 * @returns {string}
 */
export function checkoutCloudImagePath() {
  try {
    const exec = realpathSync(process.execPath)
    if (!exec.endsWith(`${sep}qctl-host`)) return ''
    return join(dirname(exec), '..', 'packages', 'platform-rocky', 'cloud-image.json')
  } catch {
    return ''
  }
}

/**
 * JSON staged beside `qctl-platform-rocky.mjs` (`dist/` or tooling cache).
 * @returns {string[]}
 */
export function pluginCloudImageCandidates() {
  /** @type {string[]} */
  const out = []
  if (process.env.QCTL_GUEST_DIST) {
    out.push(join(process.env.QCTL_GUEST_DIST, 'cloud-image.json'))
  }
  try {
    const exec = realpathSync(process.execPath)
    if (exec.endsWith(`${sep}qctl-host`)) {
      out.push(join(dirname(exec), 'cloud-image.json'))
    }
  } catch {
    // ignore
  }
  // Workspace / sibling compile output.
  // packages/host/src → repo root dist/
  out.push(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'cloud-image.json'),
  )
  return out
}

/**
 * @param {CloudImagePinCandidate | RockyCloudImage | string | number | boolean | null | undefined} raw
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
function readPin(filePath) {
  /** @type {CloudImagePinCandidate} */
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  return normalizeCloudImage(parsed, filePath)
}

/**
 * @returns {string}
 */
export function resolveCloudImagePinPath() {
  const fromEnv = process.env.QCTL_ROCKY_CLOUD_IMAGE?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  const workspace = workspaceCloudImagePath()
  if (existsSync(workspace)) return workspace

  const checkout = checkoutCloudImagePath()
  if (checkout && existsSync(checkout)) return checkout

  for (const p of pluginCloudImageCandidates()) {
    if (existsSync(p)) return p
  }

  throw new Error(
    'Rocky cloud image pin not found (cloud-image.json).\n'
      + '  Set QCTL_ROCKY_CLOUD_IMAGE, use a workspace with packages/platform-rocky/cloud-image.json,'
      + ' or download the platform plugin (`qctl-platform-rocky.mjs`) via ensureCloudImage.',
  )
}

/**
 * @returns {RockyCloudImage}
 */
export function loadCloudImage() {
  if (cached) return cached
  cached = readPin(resolveCloudImagePinPath())
  return cached
}

/**
 * @param {RockyCloudImage} pin
 * @returns {RockyCloudImage}
 */
export function setCloudImageCache(pin) {
  cached = normalizeCloudImage(pin)
  return cached
}

/**
 * Persist pin next to a downloaded platform plugin for later sync resolve.
 * @param {string} dir
 * @param {RockyCloudImage} pin
 */
export function writeCloudImagePin(dir, pin) {
  const normalized = normalizeCloudImage(pin)
  writeFileSync(join(dir, 'cloud-image.json'), `${JSON.stringify(normalized, null, 2)}\n`)
}

/**
 * Load `CLOUD_IMAGE` from a downloaded / compiled `qctl-platform-rocky.mjs`.
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
