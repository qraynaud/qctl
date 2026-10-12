#!/usr/bin/env bun
/**
 * Commit-subject changelog since the previous `v*` tag (exclusive of that tag).
 * One line per commit (`- subject`); no bodies. Merge commits omitted.
 *
 * Usage: bun ci/release-changelog.js
 * Env:   none required (runs `git` in the repo root).
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')

/**
 * @param {string[]} args
 * @returns {string}
 */
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim() || `git ${args.join(' ')} failed`
    throw new Error(err)
  }
  return (r.stdout || '').trimEnd()
}

/**
 * @param {string[]} subjects
 * @returns {string}
 */
export function formatChangelog(subjects) {
  if (subjects.length === 0) return '_No commits since the previous release tag._'
  return subjects.map((s) => `- ${s}`).join('\n')
}

/**
 * @returns {{ prevTag: string | null, subjects: string[], markdown: string }}
 */
export function buildChangelog() {
  const tags = git(['tag', '-l', 'v*', '--sort=-v:refname'])
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
  const prevTag = tags[0] ?? null
  const range = prevTag ? `${prevTag}..HEAD` : 'HEAD'
  const raw = git(['log', '--pretty=format:%s', '--no-merges', range])
  const subjects = raw
    ? raw
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  return { prevTag, subjects, markdown: formatChangelog(subjects) }
}

if (import.meta.main) {
  const { prevTag, markdown } = buildChangelog()
  if (prevTag) {
    console.error(`changelog since ${prevTag}`)
  } else {
    console.error('changelog (no previous v* tag)')
  }
  console.log(markdown)
}
