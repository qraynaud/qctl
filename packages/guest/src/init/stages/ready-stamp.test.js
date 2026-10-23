import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { createContext } from '../context.js'
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
  test('stampPaths prefers QCTL_* over defaults', () => {
    const ctx = createContext({
      env: {
        QCTL_ENV: 'dev',
        QCTL_STAMP_DIR: '/tmp/stamps',
        QCTL_STAMP_FILE: '/tmp/stamps/done',
        QCTL_ROOT: '/tank/x',
        QCTL_HG_BIN: '/bin/hg',
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

  test('run writes stamp file when hg id succeeds', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const file = join(dir, 'first-boot.done')
    const ctx = createContext({
      env: {
        QCTL_ENV: 'dev',
        QCTL_STAMP_DIR: dir,
        QCTL_STAMP_FILE: file,
        QCTL_ROOT: '/tank/rocky',
        QCTL_HG_BIN: '/usr/bin/hg',
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
  })

  test('run requires root', async () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      isRoot: () => false,
    })
    await expect(readyStamp.run(ctx)).rejects.toBeInstanceOf(StageError)
  })
})
