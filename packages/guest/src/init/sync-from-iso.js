/**
 * Sync guest tooling from a mounted cidata `qctl-guest/` tree:
 * always refresh platform `.mjs` (+ optional varlock helper), rewrite
 * `QCTL_PLATFORM_MODULE`; SHA-256-compare `qctl-guest` vs installed `qctl`
 * and re-exec when the binary changes.
 */
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { PLATFORM_LIB_DIR_DEFAULT } from './platform.js'

/** @import { CidataHandle } from './cidata.js' */

/** Set after a successful binary replace so the next run skips another re-exec. */
export const SELF_UPDATE_DONE_ENV = 'QCTL_SELF_UPDATE_DONE'

/** Test / rescue: skip ISO tooling sync (`1`). */
export const SKIP_CIDATA_SYNC_ENV = 'QCTL_SKIP_CIDATA_SYNC'

export const QCTL_BIN_DIR_DEFAULT = '/usr/local/bin'

/** Drop-in loaded by first-boot / init-tank units. */
export const PLATFORM_ENV_DROPIN_DEFAULT = '/etc/environment.d/90-qctl-platform.conf'

const PLATFORM_MOD_RE = /^qctl-platform-.+\.mjs$/

/**
 * @typedef {object} SyncToolingPaths
 * @property {string} binDir
 * @property {string} libDir
 * @property {string} platformEnvPath
 * @property {string} qctlBin Absolute path of installed guest binary (`…/qctl`).
 * @property {string} varlockBin Absolute path of installed varlock helper.
 */

/**
 * @typedef {object} SyncToolingResult
 * @property {string} platformModulePath Absolute installed platform `.mjs`.
 * @property {boolean} binaryUpdated
 * @property {boolean} varlockUpdated
 */

/**
 * @typedef {'continue' | 'reexec'} SyncDisposition
 */

/**
 * @typedef {object} SyncFromIsoResult
 * @property {SyncDisposition} disposition
 * @property {SyncToolingResult} tooling
 */

/**
 * @typedef {object} SyncFromIsoDeps
 * @property {Record<string, string | undefined>} env Mutated: sets `QCTL_PLATFORM_MODULE`.
 * @property {(line: string) => void} [log]
 * @property {Partial<SyncToolingPaths>} [paths]
 * @property {(src: string, dest: string, mode: number) => void} [installFile]
 * @property {(path: string) => string} [sha256File]
 */

/**
 * @param {string} p
 * @returns {boolean}
 */
function isFile(p) {
  try {
    return existsSync(p) && statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * @param {string} path
 * @returns {string}
 */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Atomic install: copy to `dest.qctl-new`, chmod, rename over `dest`.
 * @param {string} src
 * @param {string} dest
 * @param {number} mode
 */
export function installFileAtomic(src, dest, mode) {
  mkdirSync(dirname(dest), { recursive: true })
  const tmp = `${dest}.qctl-new`
  copyFileSync(src, tmp)
  chmodSync(tmp, mode)
  renameSync(tmp, dest)
}

/**
 * @param {string} guestDir
 * @returns {string} Absolute path of the sole `qctl-platform-*.mjs`
 */
export function findIsoPlatformModule(guestDir) {
  let names
  try {
    names = readdirSync(guestDir).filter((n) => PLATFORM_MOD_RE.test(n))
  } catch (err) {
    throw new Error(`cannot read ${guestDir}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (names.length !== 1) {
    throw new Error(
      `expected exactly one qctl-platform-*.mjs under ${guestDir} (found ${names.length})`,
    )
  }
  const abs = join(guestDir, names[0])
  if (!isFile(abs)) {
    throw new Error(`platform module not a file: ${abs}`)
  }
  return abs
}

/**
 * @param {string} libDir
 * @param {string} keepBasename
 */
function dropStalePlatformModules(libDir, keepBasename) {
  let names
  try {
    names = readdirSync(libDir)
  } catch {
    return
  }
  for (const name of names) {
    if (name === keepBasename) continue
    if (!PLATFORM_MOD_RE.test(name) && name !== 'qctl-platform-rocky') continue
    rmSync(join(libDir, name), { force: true })
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {Partial<SyncToolingPaths>} [overrides]
 * @returns {SyncToolingPaths}
 */
export function resolveSyncToolingPaths(env, overrides = {}) {
  const binDir = overrides.binDir ?? env.QCTL_BIN_DIR?.trim() ?? QCTL_BIN_DIR_DEFAULT
  const libDir = overrides.libDir ?? env.QCTL_LIB_DIR?.trim() ?? PLATFORM_LIB_DIR_DEFAULT
  const platformEnvPath =
    overrides.platformEnvPath ?? env.QCTL_PLATFORM_ENV_PATH?.trim() ?? PLATFORM_ENV_DROPIN_DEFAULT
  return {
    binDir,
    libDir,
    platformEnvPath,
    qctlBin: overrides.qctlBin ?? join(binDir, 'qctl'),
    varlockBin: overrides.varlockBin ?? join(binDir, 'varlock-local-encrypt'),
  }
}

/**
 * Always install platform (+ varlock when present); update binary when hash differs.
 * Sets `env.QCTL_PLATFORM_MODULE` for the current process.
 *
 * @param {Pick<CidataHandle, 'guestDir'>} cidata
 * @param {SyncFromIsoDeps} deps
 * @returns {SyncFromIsoResult}
 */
export function syncToolingFromIso(cidata, deps) {
  const log = deps.log ?? (() => {})
  const install = deps.installFile ?? installFileAtomic
  const hash = deps.sha256File ?? sha256File
  const env = deps.env
  const paths = resolveSyncToolingPaths(env, deps.paths)

  const isoGuestBin = join(cidata.guestDir, 'qctl-guest')
  if (!isFile(isoGuestBin)) {
    throw new Error(`missing qctl-guest under ${cidata.guestDir}`)
  }

  const isoPlatform = findIsoPlatformModule(cidata.guestDir)
  const modBase = basename(isoPlatform)
  const destPlatform = join(paths.libDir, modBase)
  mkdirSync(paths.libDir, { recursive: true })
  install(isoPlatform, destPlatform, 0o644)
  dropStalePlatformModules(paths.libDir, modBase)
  mkdirSync(dirname(paths.platformEnvPath), { recursive: true })
  writeFileSync(paths.platformEnvPath, `QCTL_PLATFORM_MODULE=${destPlatform}\n`, {
    encoding: 'utf8',
    mode: 0o644,
  })
  env.QCTL_PLATFORM_MODULE = destPlatform
  log(`qctl sync-from-iso: platform → ${destPlatform}`)

  let varlockUpdated = false
  const isoVarlock = join(cidata.guestDir, 'varlock-local-encrypt')
  if (isFile(isoVarlock)) {
    install(isoVarlock, paths.varlockBin, 0o755)
    varlockUpdated = true
    log(`qctl sync-from-iso: varlock-local-encrypt → ${paths.varlockBin}`)
  }

  const selfUpdateDone = env[SELF_UPDATE_DONE_ENV] === '1'
  let binaryUpdated = false
  const isoHash = hash(isoGuestBin)
  const installedHash = isFile(paths.qctlBin) ? hash(paths.qctlBin) : null
  if (isoHash !== installedHash) {
    install(isoGuestBin, paths.qctlBin, 0o755)
    binaryUpdated = true
    log(`qctl sync-from-iso: qctl binary updated (${paths.qctlBin})`)
  } else {
    log('qctl sync-from-iso: qctl binary up to date')
  }

  /** @type {SyncDisposition} */
  const disposition = binaryUpdated && !selfUpdateDone ? 'reexec' : 'continue'
  return {
    disposition,
    tooling: {
      platformModulePath: destPlatform,
      binaryUpdated,
      varlockUpdated,
    },
  }
}

/**
 * Re-exec the current guest argv with {@link SELF_UPDATE_DONE_ENV}=1.
 *
 * @param {{
 *   env: Record<string, string | undefined>,
 *   execPath?: string,
 *   argv?: string[],
 *   spawn?: (argv: string[], env: Record<string, string | undefined>) => Promise<number>,
 * }} opts
 * @returns {Promise<number>} child exit code
 */
export async function reexecAfterSelfUpdate(opts) {
  const execPath = opts.execPath ?? process.execPath
  const argvTail = (opts.argv ?? process.argv).slice(1)
  /** @type {Record<string, string | undefined>} */
  const childEnv = { ...opts.env, [SELF_UPDATE_DONE_ENV]: '1' }

  const spawn =
    opts.spawn
    ?? (async (argv, env) => {
      const proc = Bun.spawn(argv, {
        env: /** @type {Record<string, string>} */ (
          Object.fromEntries(Object.entries(env).filter((e) => e[1] != null))
        ),
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      })
      return proc.exited
    })

  return spawn([execPath, ...argvTail], childEnv)
}
