import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { createLocalContext, ensureLocalDiskHostDirs, localRepoDir } from './context.js'
import { LOCAL_DISK_KIND, localDiskMounts } from './disk-mounts.js'
import * as utilMod from './util.js'
import { LocalExit } from './util.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
  // @ts-expect-error restore
  utilMod.die.mockRestore?.()
  // @ts-expect-error restore
  process.chdir.mockRestore?.()
})

describe('localRepoDir', () => {
  test('requires repo.dir (no silent default)', () => {
    expect(() => localRepoDir(undefined)).toThrow(LocalExit)
    expect(() => localRepoDir({})).toThrow(LocalExit)
    expect(() => localRepoDir({ dir: '  ' })).toThrow(LocalExit)
  })

  test('uses trimmed repo.dir', () => {
    expect(localRepoDir({ dir: ' /tank/custom ' })).toBe('/tank/custom')
  })
})

describe('ensureLocalDiskHostDirs', () => {
  test('creates volumes/tank|data/<key> under the instance root', () => {
    const root = makeTempDir()
    temps.push(root)
    const mounts = localDiskMounts({
      data: { vw: { mount: '/vw' } },
      tanks: { tank: { mount: '/tank' } },
    })
    ensureLocalDiskHostDirs(root, mounts)
    expect(existsSync(join(root, 'volumes/tank/tank'))).toBe(true)
    expect(existsSync(join(root, 'volumes/data/vw'))).toBe(true)
    expect(mounts[0]?.kind).toBe(LOCAL_DISK_KIND.TANK)
  })
})

describe('createLocalContext', () => {
  test('dies when cwd is not an instance root', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const prev = process.cwd()
    process.chdir(dir)
    const die = spyOn(utilMod, 'die').mockImplementation(
      /** @returns {never} */ (msg) => {
        throw new Error(String(msg))
      },
    )
    try {
      await expect(createLocalContext({ env: 'dev' })).rejects.toThrow(/not inside a qctl instance/)
      expect(die).toHaveBeenCalled()
    } finally {
      process.chdir(prev)
    }
  })
})
