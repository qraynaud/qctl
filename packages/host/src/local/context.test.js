import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { createLocalContext } from './context.js'
import * as utilMod from './util.js'
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
