/**
 * Mount / resolve the NoCloud cidata volume (LABEL=cidata).
 * Layout: `qctl-guest/` (tooling) + `qctl-seed/` (config + tier0).
 */
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { QCTL_GUEST_ISO_DIR, QCTL_SEED_ISO_DIR } from '@qctl/shared'

import { spawnCapture } from './context.js'

/**
 * Env override: already-unpacked cidata tree (tests / keep-cidata).
 * When set, no blkid/mount — {@link openCidata} just resolves paths.
 */
export const CIDATA_ROOT_ENV = 'QCTL_CIDATA_ROOT'

/**
 * Env override: path to the `qctl-guest/` directory only (matches install-qctl-guest.sh).
 * Seed dir is assumed at `dirname(guest)/qctl-seed`.
 */
export const GUEST_SRC_ENV = 'QCTL_GUEST_SRC'

/**
 * @typedef {object} CidataPaths
 * @property {string} root Absolute cidata tree root.
 * @property {string} guestDir `${root}/qctl-guest`
 * @property {string} seedDir `${root}/qctl-seed`
 */

/**
 * @typedef {object} CidataHandle
 * @property {string} root
 * @property {string} guestDir
 * @property {string} seedDir
 * @property {boolean} mounted True when this handle owns a mount (must {@link CidataHandle.close}).
 * @property {() => Promise<void>} close Umount + remove mountpoint when `mounted`; no-op otherwise.
 */

/**
 * @typedef {object} OpenCidataDeps
 * @property {Record<string, string | undefined>} [env]
 * @property {(labels: string[]) => Promise<string | null>} [findDevice]
 * @property {(dev: string, mountpoint: string) => Promise<void>} [mountRo]
 * @property {(mountpoint: string) => Promise<void>} [umount]
 * @property {() => string} [mkdtemp]
 */

/**
 * @param {string} p
 * @returns {boolean}
 */
function isDir(p) {
  try {
    return existsSync(p) && statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * @param {string} root
 * @returns {CidataPaths}
 */
export function cidataPathsFromRoot(root) {
  const abs = resolve(root)
  return {
    root: abs,
    guestDir: join(abs, QCTL_GUEST_ISO_DIR),
    seedDir: join(abs, QCTL_SEED_ISO_DIR),
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<string | null>}
 */
async function defaultFindDevice(env) {
  for (const label of ['cidata', 'CIDATA']) {
    const r = await spawnCapture(['blkid', '-L', label], env)
    const dev = r.stdout.trim()
    if (r.code === 0 && dev) return dev
  }
  return null
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} dev
 * @param {string} mountpoint
 */
async function defaultMountRo(env, dev, mountpoint) {
  mkdirSync(mountpoint, { recursive: true })
  const r = await spawnCapture(['mount', '-o', 'ro', dev, mountpoint], env)
  if (r.code !== 0) {
    throw new Error(`mount ${dev} → ${mountpoint} failed: ${r.stderr.trim() || `exit ${r.code}`}`)
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} mountpoint
 */
async function defaultUmount(env, mountpoint) {
  await spawnCapture(['umount', mountpoint], env)
}

/**
 * Open the cidata volume (or env override). Caller must `await handle.close()`.
 *
 * @param {OpenCidataDeps} [deps]
 * @returns {Promise<CidataHandle>}
 */
export async function openCidata(deps = {}) {
  const env = deps.env ?? process.env
  const findDevice = deps.findDevice ?? (() => defaultFindDevice(env))
  const mountRo = deps.mountRo ?? ((dev, mnt) => defaultMountRo(env, dev, mnt))
  const umount = deps.umount ?? ((mnt) => defaultUmount(env, mnt))
  const mkdtemp =
    deps.mkdtemp
    ?? (() => {
      const dir = join('/tmp', `qctl-cidata-${process.pid}-${Date.now()}`)
      mkdirSync(dir, { recursive: true })
      return dir
    })

  const cidataRoot = env[CIDATA_ROOT_ENV]?.trim()
  if (cidataRoot) {
    const paths = cidataPathsFromRoot(cidataRoot)
    if (!isDir(paths.root)) {
      throw new Error(`${CIDATA_ROOT_ENV}=${cidataRoot} is not a directory`)
    }
    return { ...paths, mounted: false, close: async () => {} }
  }

  const guestSrc = env[GUEST_SRC_ENV]?.trim()
  if (guestSrc) {
    const guestDir = resolve(guestSrc)
    if (!isDir(guestDir)) {
      throw new Error(`${GUEST_SRC_ENV}=${guestSrc} is not a directory`)
    }
    const root = resolve(guestDir, '..')
    return {
      root,
      guestDir,
      seedDir: join(root, QCTL_SEED_ISO_DIR),
      mounted: false,
      close: async () => {},
    }
  }

  const dev = await findDevice(['cidata', 'CIDATA'])
  if (!dev) {
    throw new Error('no NoCloud volume (LABEL=cidata) — was the seed attached?')
  }

  const mountpoint = mkdtemp()
  try {
    await mountRo(dev, mountpoint)
  } catch (err) {
    rmSync(mountpoint, { recursive: true, force: true })
    throw err
  }

  const paths = cidataPathsFromRoot(mountpoint)
  return {
    ...paths,
    mounted: true,
    close: async () => {
      try {
        await umount(mountpoint)
      } finally {
        rmSync(mountpoint, { recursive: true, force: true })
      }
    },
  }
}
