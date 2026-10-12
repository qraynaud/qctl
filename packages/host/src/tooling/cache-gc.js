/**
 * Touch-on-use + prune stale files under `$XDG_CACHE_HOME/qctl` (not VM disks).
 */
import { readdirSync, rmSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'

import { chalk } from 'zx'

import { getCacheHome } from '../lib/paths.js'

/** @type {number} */
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Bump atime/mtime so cache GC keeps the path.
 * @param {string} filePath
 */
export function touchPath(filePath) {
  try {
    const now = new Date()
    utimesSync(filePath, now, now)
  } catch {
    /* missing / permission — ignore */
  }
}

/**
 * @param {string} dir
 * @param {(abs: string) => void} visitFile
 */
function walkFiles(dir, visitFile) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const abs = join(dir, ent.name)
    if (ent.isDirectory()) walkFiles(abs, visitFile)
    else if (ent.isFile()) visitFile(abs)
  }
}

/**
 * @param {string} dir
 * @returns {boolean} true if dir was removed or never existed
 */
function removeEmptyDirs(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return true
  }
  for (const ent of entries) {
    if (ent.isDirectory()) removeEmptyDirs(join(dir, ent.name))
  }
  try {
    entries = readdirSync(dir)
    if (entries.length === 0) {
      rmSync(dir)
      return true
    }
  } catch {
    return true
  }
  return false
}

/**
 * Delete cache files older than `maxAgeMs`, then prune empty directories.
 * Scope: entire getCacheHome() tree (images, tooling, per-repo seed artifacts).
 * Does not touch XDG data home (VM disks).
 *
 * @param {{ maxAgeMs?: number, now?: number }} [opts]
 * @returns {{ removed: string[] }}
 */
export function gcQctlCache(opts = {}) {
  const maxAgeMs = opts.maxAgeMs ?? CACHE_MAX_AGE_MS
  const now = opts.now ?? Date.now()
  const root = getCacheHome()
  /** @type {string[]} */
  const removed = []

  walkFiles(root, (abs) => {
    let st
    try {
      st = statSync(abs)
    } catch {
      return
    }
    if (now - st.mtimeMs <= maxAgeMs) return
    try {
      rmSync(abs)
      removed.push(abs)
    } catch {
      /* busy / perm */
    }
  })

  removeEmptyDirs(root)

  if (removed.length) {
    console.log(chalk.dim(`  cache gc: removed ${removed.length} stale file(s) under ${root}`))
  }
  return { removed }
}
