/**
 * Detect clone URL from the host working tree (git origin / hg default).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string | null}
 */
function runCapture(cmd, args, cwd) {
  try {
    const r = spawnSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      timeout: 5_000,
    })
    if (r.status !== 0) return null
    const out = String(r.stdout ?? '').trim()
    return out || null
  } catch {
    return null
  }
}

/**
 * Walk up looking for `.git` or `.hg`.
 * @param {string} start
 * @returns {{ kind: 'git' | 'hg', root: string } | null}
 */
export function findVcsRoot(start) {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(join(dir, '.git'))) return { kind: 'git', root: dir }
    if (existsSync(join(dir, '.hg'))) return { kind: 'hg', root: dir }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * @param {string} [startDir] Directory to search upward from (default: cwd)
 * @returns {{ git?: string, hg?: string }}
 */
export function detectHostCloneRemotes(startDir = process.cwd()) {
  /** @type {{ git?: string, hg?: string }} */
  const out = {}
  const found = findVcsRoot(startDir)
  if (!found) return out

  if (found.kind === 'git') {
    const url =
      runCapture('git', ['remote', 'get-url', 'origin'], found.root)
      ?? runCapture('git', ['config', '--get', 'remote.origin.url'], found.root)
    if (url) out.git = url
  } else {
    const url = runCapture('hg', ['paths', 'default'], found.root)
    if (url) out.hg = url
  }
  return out
}

/**
 * Best clone URL for a chosen VCS, if the host tree has one.
 * @param {'git' | 'hg'} vcs
 * @param {string} [startDir]
 * @returns {string}
 */
export function cloneUrlSuggestion(vcs, startDir = process.cwd()) {
  const remotes = detectHostCloneRemotes(startDir)
  return remotes[vcs] ?? ''
}

/**
 * Preferred VCS from the host tree (else null).
 * @param {string} [startDir]
 * @returns {'git' | 'hg' | null}
 */
export function suggestedVcs(startDir = process.cwd()) {
  const found = findVcsRoot(startDir)
  return found?.kind ?? null
}

/**
 * Clone URL / VCS hints for init — **only** the instance target directory
 * (no walk-up, no `process.cwd()` fallback).
 *
 * Prefers `hg` when the target has `.hg` and no `.git`; otherwise `git` if
 * `.git` is present.
 *
 * @param {string} targetDir Instance root from `qctl init [dir]`
 * @returns {{ git?: string, hg?: string, vcs: 'git' | 'hg' | null }}
 */
export function hostCloneContext(targetDir) {
  const dir = resolve(targetDir)
  const hasGit = existsSync(join(dir, '.git'))
  const hasHg = existsSync(join(dir, '.hg'))

  /** @type {'git' | 'hg' | null} */
  let vcs = null
  if (hasHg && !hasGit) vcs = 'hg'
  else if (hasGit) vcs = 'git'

  /** @type {{ git?: string, hg?: string, vcs: 'git' | 'hg' | null }} */
  const out = { vcs }
  if (vcs === 'git') {
    const url =
      runCapture('git', ['remote', 'get-url', 'origin'], dir)
      ?? runCapture('git', ['config', '--get', 'remote.origin.url'], dir)
    if (url) out.git = url
  } else if (vcs === 'hg') {
    const url = runCapture('hg', ['paths', 'default'], dir)
    if (url) out.hg = url
  }
  return out
}
