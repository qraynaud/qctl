/**
 * Materialize `varlock-local-encrypt` where varlock's SEA sibling resolver looks:
 * `dirname(realpath(process.execPath))/varlock-local-encrypt` (then `../libexec/`).
 *
 * PATH is not consulted. Unwritable install dirs (e.g. root-owned `/usr/local/bin`)
 * cannot be fixed at runtime — the package must ship the helper beside `qctl`.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

/** @type {string | null | undefined} */
let configuredEmbedPath

/** @type {string | null | undefined} */
let cachedResult

/**
 * Optional embed path from the compiled host/guest binary (`bun --asset`).
 * @param {string | null | undefined} path
 */
export function configureNativeHelperEmbed(path) {
  configuredEmbedPath = path && String(path).trim() ? String(path).trim() : null
  cachedResult = undefined
}

/** Clear memoized result (tests). */
export function resetNativeHelperCache() {
  cachedResult = undefined
}

/** @returns {string} */
export function varlockLocalEncryptName() {
  return process.platform === 'win32' ? 'varlock-local-encrypt.exe' : 'varlock-local-encrypt'
}

/**
 * @returns {string | undefined}
 */
function nativeHelperPackageName() {
  if (process.platform === 'darwin') return '@varlock/native-helper-darwin'
  if (process.platform === 'win32') return `@varlock/native-helper-win32-${process.arch}`
  if (process.platform === 'linux') return `@varlock/native-helper-linux-${process.arch}`
  return undefined
}

/**
 * Resolve helper from `@varlock/native-helper-*` (bun/dev installs).
 * @returns {string | undefined}
 */
export function resolveNativeHelperFromNpm() {
  const pkgName = nativeHelperPackageName()
  if (!pkgName) return undefined
  const name = varlockLocalEncryptName()
  /** @type {string[]} */
  const bases = [import.meta.url, fileURLToPath(import.meta.url)]
  for (const from of bases) {
    try {
      const req = createRequire(from)
      const pkgJson = req.resolve(`${pkgName}/package.json`)
      const bin = join(dirname(pkgJson), name)
      if (existsSync(bin)) return bin
      if (process.platform === 'darwin') {
        const appBin = join(
          dirname(pkgJson),
          'VarlockEnclave.app',
          'Contents',
          'MacOS',
          'varlock-local-encrypt',
        )
        if (existsSync(appBin)) return appBin
      }
    } catch {
      // try next
    }
  }
  try {
    const pkgJson = require.resolve(`${pkgName}/package.json`)
    const bin = join(dirname(pkgJson), name)
    if (existsSync(bin)) return bin
  } catch {
    // absent
  }
  return undefined
}

/**
 * True when this process is a compiled qctl host/guest binary (not `bun` itself).
 * @returns {boolean}
 */
export function isCompiledQctlBinary() {
  try {
    const exec = realpathSync(process.execPath)
    return (
      exec.endsWith(`${sep}qctl-host`)
      || exec.endsWith(`${sep}qctl-guest`)
      || exec.endsWith(`${sep}qctl`)
    )
  } catch {
    return false
  }
}

/** @returns {string} */
function toolingCacheDir() {
  if (process.env.QCTL_CACHE_HOME?.trim()) {
    return join(process.env.QCTL_CACHE_HOME.trim(), 'tooling', 'native')
  }
  const xdg = process.env.XDG_CACHE_HOME?.trim()
  if (xdg) return join(xdg, 'qctl', 'tooling', 'native')
  return join(homedir(), '.cache', 'qctl', 'tooling', 'native')
}

/**
 * True when `path` is readable (Bun `$bunfs` `--asset` holes can pass `existsSync`
 * but fail `copyFileSync` / `readFileSync`).
 * @param {string | undefined | null} path
 * @returns {boolean}
 */
function isReadableFile(path) {
  if (!path || !existsSync(path)) return false
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Materialize `src` → `dest`. Prefer read/write so Bun `$bunfs` assets work
 * (same pattern as host seed-kit); fall back to `copyFileSync` for normal FS.
 * @param {string} dest
 * @param {string} src
 */
function syncFile(dest, src) {
  mkdirSync(dirname(dest), { recursive: true })
  const tmp = `${dest}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, readFileSync(src))
  } catch {
    copyFileSync(src, tmp)
  }
  if (process.platform !== 'win32') chmodSync(tmp, 0o755)
  renameSync(tmp, dest)
}

/**
 * Helper already beside the running binary (checkout `dist/`, packaged install).
 * @returns {string | undefined}
 */
function resolveSiblingHelper() {
  const name = varlockLocalEncryptName()
  try {
    const sibling = join(dirname(realpathSync(process.execPath)), name)
    if (isReadableFile(sibling)) return sibling
  } catch {
    // ignore
  }
  return undefined
}

/**
 * @param {string} sibling
 * @param {string} cachePath
 * @returns {boolean}
 */
function linkOrCopySibling(sibling, cachePath) {
  try {
    if (existsSync(sibling)) {
      try {
        if (realpathSync(sibling) === realpathSync(cachePath)) return true
      } catch {
        // replace stale/broken
      }
      unlinkSync(sibling)
    }
    try {
      symlinkSync(cachePath, sibling)
      return true
    } catch {
      copyFileSync(cachePath, sibling)
      if (process.platform !== 'win32') chmodSync(sibling, 0o755)
      return true
    }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : ''
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return false
    throw err
  }
}

/**
 * Ensure varlock can resolve the native helper (SEA sibling when compiled).
 *
 * @param {{ embedPath?: string | null, quiet?: boolean }} [opts]
 * @returns {Promise<string | null>} path to the real helper file (cache / npm / embed)
 */
export async function ensureVarlockLocalEncrypt(opts = {}) {
  if (cachedResult !== undefined) return cachedResult

  const name = varlockLocalEncryptName()
  const fromEnv = process.env.QCTL_VARLOCK_LOCAL_ENCRYPT?.trim()
  const embed = opts.embedPath ?? configuredEmbedPath
  const sibling = resolveSiblingHelper()
  const npm = resolveNativeHelperFromNpm()

  /** @type {string | undefined} */
  let src
  if (isReadableFile(fromEnv)) src = /** @type {string} */ (fromEnv)
  else if (sibling) src = sibling
  else if (npm && isReadableFile(npm)) src = npm
  else if (isReadableFile(embed)) src = /** @type {string} */ (embed)

  if (!src) {
    if (!opts.quiet) {
      console.warn(
        'qctl: varlock-local-encrypt not found — local encryption falls back to file/memory.\n'
          + '  Dev: bun install (optional @varlock/native-helper-*).\n'
          + '  Release: use a qctl-host built with the helper asset, or set QCTL_VARLOCK_LOCAL_ENCRYPT.',
      )
    }
    cachedResult = null
    return null
  }

  // Already a real sibling beside this binary — nothing to materialize.
  if (sibling && src === sibling) {
    cachedResult = sibling
    return sibling
  }

  const cachePath = join(toolingCacheDir(), name)
  try {
    if (!existsSync(cachePath) || realpathSync(cachePath) !== realpathSync(src)) {
      if (cachePath !== src) syncFile(cachePath, src)
    }
  } catch {
    syncFile(cachePath, src)
  }

  if (isCompiledQctlBinary()) {
    try {
      const execDir = dirname(realpathSync(process.execPath))
      const destSibling = join(execDir, name)
      const ok = linkOrCopySibling(destSibling, cachePath)
      if (!ok && !opts.quiet) {
        console.warn(
          `qctl: cannot write ${destSibling} (install dir not writable).\n`
            + '  Varlock only looks beside the qctl binary (not PATH).\n'
            + '  For system installs, the package must ship varlock-local-encrypt next to qctl\n'
            + `  (e.g. copy into ${execDir}).`,
        )
      }
    } catch (err) {
      if (!opts.quiet) {
        console.warn(
          `qctl: failed to place varlock-local-encrypt beside binary: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
  }

  cachedResult = cachePath
  return cachePath
}
