/**
 * Guest init progress — `/var/lib/qctl/init-state.json` (not on volume roots).
 * Thin systemd stamps (`first-boot.done` / `init-tank-done`) stay sibling files.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

/** @import { StagePaths } from './context.js' */

/** Default dir for init-state + thin stamps. */
export const QCTL_VAR_DIR_DEFAULT = '/var/lib/qctl'

export const INIT_STATE_FILENAME = 'init-state.json'
export const FIRST_BOOT_STAMP = 'first-boot.done'
export const INIT_TANK_STAMP = 'init-tank-done'

const nonEmpty = z
  .string()
  .min(1)
  .refine((s) => s === s.trim(), { message: 'must not have leading or trailing whitespace' })

export const initStateDataMountSchema = z.strictObject({
  mount: nonEmpty,
  preparedAt: nonEmpty,
  uuid: nonEmpty.optional(),
})

export const initStateTankCanarySchema = z.strictObject({
  line: z.string().min(1),
  writtenAt: nonEmpty,
  drillVerifiedAt: nonEmpty.optional(),
})

export const initStateTankSchema = z.strictObject({
  mount: nonEmpty,
  importedAt: nonEmpty.optional(),
  canary: initStateTankCanarySchema.optional(),
})

export const initStateInitTankSchema = z.strictObject({
  completedAt: nonEmpty,
  pools: nonEmpty.array(),
  force: z.boolean().optional(),
})

export const initStateSchema = z.strictObject({
  version: z.literal(1),
  profile: z.enum(['default', 'init-tank']).optional(),
  readyAt: nonEmpty.optional(),
  hostname: nonEmpty.optional(),
  hgId: nonEmpty.optional(),
  checks: z
    .strictObject({
      tank: nonEmpty.optional(),
      vw: nonEmpty.optional(),
    })
    .optional(),
  dataMounts: z.record(nonEmpty, initStateDataMountSchema).optional(),
  initTank: initStateInitTankSchema.optional(),
  tanks: z.record(nonEmpty, initStateTankSchema).optional(),
})

/** @typedef {z.infer<typeof initStateSchema>} InitState */
/** @typedef {z.input<typeof initStateSchema>} InitStateInput */
/** @typedef {Omit<InitStateInput, 'version'>} InitStatePatch */
/** @typedef {z.infer<typeof initStateDataMountSchema>} InitStateDataMount */
/** @typedef {z.infer<typeof initStateTankSchema>} InitStateTank */

/**
 * @param {StagePaths} [paths]
 * @returns {string}
 */
export function resolveQctlVarDir(paths = {}) {
  return paths.qctlVarDir?.trim() || QCTL_VAR_DIR_DEFAULT
}

/**
 * @param {StagePaths} [paths]
 * @returns {string}
 */
export function resolveInitStatePath(paths = {}) {
  return paths.initState?.trim() || join(resolveQctlVarDir(paths), INIT_STATE_FILENAME)
}

/**
 * Durable write: temp file → fsync → rename → fsync dir (survives host destroy
 * right after cloud-init Final Stage).
 *
 * @param {string} path
 * @param {string} body
 * @param {number} [mode]
 */
export function writeFileAtomic(path, body, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, body, { encoding: 'utf8', mode })
  const fd = openSync(tmp, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
  const dirFd = openSync(dirname(path), 'r')
  try {
    fsyncSync(dirFd)
  } finally {
    closeSync(dirFd)
  }
}

/**
 * @param {string} [path]
 * @returns {InitState}
 */
export function readInitState(path = resolveInitStatePath()) {
  if (!existsSync(path)) {
    return { version: 1 }
  }
  try {
    return initStateSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const quarantine = `${path}.corrupt.${Date.now()}`
    try {
      renameSync(path, quarantine)
      console.warn(`qctl init-state: quarantined corrupt ${path} → ${quarantine} (${detail})`)
    } catch (moveErr) {
      throw new Error(
        `failed to read init-state ${path}: ${detail}; also failed to quarantine: `
          + `${moveErr instanceof Error ? moveErr.message : String(moveErr)}`,
      )
    }
    return { version: 1 }
  }
}

/**
 * Deep-merge patch into current state and write.
 *
 * @param {InitStatePatch} patch
 * @param {{ path?: string, paths?: StagePaths }} [opts]
 * @returns {InitState}
 */
export function mergeInitState(patch, opts = {}) {
  const path = opts.path ?? resolveInitStatePath(opts.paths)
  const cur = readInitState(path)
  /** @type {InitStateInput} */
  const merged = {
    version: 1,
    profile: patch.profile ?? cur.profile,
    readyAt: patch.readyAt ?? cur.readyAt,
    hostname: patch.hostname ?? cur.hostname,
    hgId: patch.hgId ?? cur.hgId,
    checks: patch.checks ? { ...cur.checks, ...patch.checks } : cur.checks,
    dataMounts: patch.dataMounts ? { ...cur.dataMounts, ...patch.dataMounts } : cur.dataMounts,
    initTank: patch.initTank ?? cur.initTank,
    tanks: mergeTanks(cur.tanks, patch.tanks),
  }
  const cleaned = JSON.parse(JSON.stringify(merged))
  const next = initStateSchema.parse(cleaned)
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

/**
 * @param {InitState['tanks']} cur
 * @param {InitStatePatch['tanks']} patch
 * @returns {InitStateInput['tanks']}
 */
function mergeTanks(cur, patch) {
  if (!patch) return cur
  /** @type {NonNullable<InitStateInput['tanks']>} */
  const out = { ...(cur || {}) }
  for (const [id, tank] of Object.entries(patch)) {
    const prev = out[id]
    out[id] = {
      mount: tank.mount ?? prev?.mount ?? '',
      importedAt: tank.importedAt ?? prev?.importedAt,
      canary: tank.canary
        ? {
            line: tank.canary.line,
            writtenAt: tank.canary.writtenAt,
            drillVerifiedAt: tank.canary.drillVerifiedAt ?? prev?.canary?.drillVerifiedAt,
          }
        : prev?.canary,
    }
  }
  return out
}

/**
 * Write a thin stamp file for systemd `ConditionPathExists`.
 *
 * @param {string} basename `first-boot.done` | `init-tank-done`
 * @param {string} body
 * @param {{
 *   paths?: StagePaths,
 *   primaryPath?: string,
 * }} [opts]
 * @returns {string[]} paths written
 */
export function writeThinStamp(basename, body, opts = {}) {
  const paths = opts.paths ?? {}
  const primary =
    opts.primaryPath
    ?? (basename === FIRST_BOOT_STAMP ? paths.firstBootStamp?.trim() : paths.initTankStamp?.trim())
    ?? join(resolveQctlVarDir(paths), basename)
  const text = body.endsWith('\n') ? body : `${body}\n`
  writeFileAtomic(primary, text)
  return [primary]
}
