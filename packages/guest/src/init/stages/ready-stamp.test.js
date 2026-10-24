import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { createTestContext, testOsConfig } from '../context.test-helpers.js'
import { StageError } from '../errors.js'
import readyStamp, { stampPaths } from './ready-stamp.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('ready-stamp stage', () => {
  test('stampPaths prefers paths/osConfig over defaults', () => {
    const ctx = createTestContext({
      osConfig: testOsConfig({ root: '/tank/x' }),
      paths: {
        qctlVarDir: '/tmp/stamps',
        firstBootStamp: '/tmp/stamps/done',
        hgBin: '/bin/hg',
      },
      log: () => {},
    })
    expect(stampPaths(ctx)).toEqual({
      dir: '/tmp/stamps',
      file: '/tmp/stamps/done',
      repoDir: '/tank/x',
      hgBin: '/bin/hg',
    })
  })

  test('stampPaths defaults under /var/lib/qctl', () => {
    const ctx = createTestContext({ log: () => {} })
    expect(stampPaths(ctx)).toEqual({
      dir: '/var/lib/qctl',
      file: '/var/lib/qctl/first-boot.done',
      repoDir: '/tank/rocky',
      hgBin: '/usr/local/bin/hg',
    })
  })

  test('run writes stamp file when hg id succeeds', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const file = join(dir, 'first-boot.done')
    const initState = join(dir, 'init-state.json')
    const ctx = createTestContext({
      paths: {
        qctlVarDir: dir,
        firstBootStamp: file,
        initState,
        hgBin: '/usr/bin/hg',
      },
      log: () => {},
      isRoot: () => true,
      exec: async (argv) => {
        if (argv[0] === '/usr/bin/hg') return { code: 0, stdout: 'abc123\n', stderr: '' }
        return { code: 1, stdout: '', stderr: 'unexpected' }
      },
    })
    await readyStamp.run(ctx)
    const body = readFileSync(file, 'utf8')
    expect(body).toContain('ok')
    expect(body).toContain('hg_id=abc123')
    const state = JSON.parse(readFileSync(initState, 'utf8'))
    expect(state.hgId).toBe('abc123')
    expect(state.checks).toEqual({ tank: 'imported', vw: 'mounted' })
  })

  test('run requires root', async () => {
    const ctx = createTestContext({
      log: () => {},
      isRoot: () => false,
    })
    await expect(readyStamp.run(ctx)).rejects.toBeInstanceOf(StageError)
  })
})
