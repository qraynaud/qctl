import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  cloneUrlSuggestion,
  detectHostCloneRemotes,
  findVcsRoot,
  hostCloneContext,
  suggestedVcs,
} from './detect-clone-url.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('detect-clone-url', () => {
  test('findVcsRoot walks up to .git', () => {
    const root = makeTempDir()
    temps.push(root)
    mkdirSync(join(root, '.git'))
    const nested = join(root, 'a', 'b')
    mkdirSync(nested, { recursive: true })
    expect(findVcsRoot(nested)).toEqual({ kind: 'git', root })
    expect(suggestedVcs(nested)).toBe('git')
  })

  test('findVcsRoot walks up to .hg', () => {
    const root = makeTempDir()
    temps.push(root)
    mkdirSync(join(root, '.hg'))
    expect(findVcsRoot(join(root, 'x'))).toEqual({ kind: 'hg', root })
    expect(suggestedVcs(join(root, 'x'))).toBe('hg')
  })

  test('detectHostCloneRemotes empty without remotes config', () => {
    const root = makeTempDir()
    temps.push(root)
    mkdirSync(join(root, '.git'))
    // bare .git dir without remotes — get-url fails
    expect(detectHostCloneRemotes(root)).toEqual({})
    expect(cloneUrlSuggestion('git', root)).toBe('')
  })

  test('reads git origin when configured', () => {
    const root = makeTempDir()
    temps.push(root)
    const init = Bun.spawnSync(['git', 'init'], { cwd: root, stdout: 'ignore', stderr: 'ignore' })
    expect(init.exitCode).toBe(0)
    const add = Bun.spawnSync(
      ['git', 'remote', 'add', 'origin', 'git@github.com:example/qctl.git'],
      { cwd: root, stdout: 'ignore', stderr: 'ignore' },
    )
    expect(add.exitCode).toBe(0)
    expect(detectHostCloneRemotes(root).git).toBe('git@github.com:example/qctl.git')
    expect(cloneUrlSuggestion('git', root)).toBe('git@github.com:example/qctl.git')
  })

  test('hostCloneContext: only target dir; hg when .hg and no .git', () => {
    const root = makeTempDir()
    temps.push(root)
    mkdirSync(join(root, '.hg'))
    expect(hostCloneContext(root)).toEqual({ vcs: 'hg' })
    // Nested path without its own .hg/.git → no walk-up
    const nested = join(root, 'inst')
    mkdirSync(nested)
    expect(hostCloneContext(nested)).toEqual({ vcs: null })
  })

  test('hostCloneContext: git wins when .git present', () => {
    const root = makeTempDir()
    temps.push(root)
    const init = Bun.spawnSync(['git', 'init'], { cwd: root, stdout: 'ignore', stderr: 'ignore' })
    expect(init.exitCode).toBe(0)
    mkdirSync(join(root, '.hg'), { recursive: true })
    expect(hostCloneContext(root).vcs).toBe('git')
  })
})
