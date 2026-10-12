import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { installPipxPackages } from './install-pipx.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { NormalizedPackages } from '@qctl/shared' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('installPipxPackages', () => {
  test('no-ops when pipx list is empty', async () => {
    await installPipxPackages([])
    await installPipxPackages(
      /** @type {NormalizedPackages['pipx']} */ (/** @type {never} */ (undefined)),
    )
  })

  test('throws when pipx is not on PATH', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    symlinkSync('/bin/bash', join(bin, 'bash'))
    await expect(
      installPipxPackages([{ package: 'mercurial==6', inject: [] }], {
        env: { PATH: bin, HOME: dir },
        log: () => {},
      }),
    ).rejects.toThrow(/pipx not on PATH/)
  })
})
