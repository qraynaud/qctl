import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import * as paths from '../../lib/paths.js'
import * as util from '../../lib/util.js'
import { resolveVmAppSelection } from './guest-apps.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  paths.tryGetRepoRoot.mockRestore?.()
  // @ts-expect-error restore
  util.die.mockRestore?.()
})

describe('resolveVmAppSelection', () => {
  test('none when no apps and not --all', () => {
    expect(resolveVmAppSelection({})).toEqual({ mode: 'none' })
  })

  test('list when apps given', () => {
    expect(resolveVmAppSelection({ apps: ['demo', 'web'] })).toEqual({
      mode: 'list',
      apps: ['demo', 'web'],
    })
  })

  test('--all discovers applications/*/app.yaml', () => {
    const root = makeTempDir()
    mkdirSync(join(root, 'applications', 'demo'), { recursive: true })
    writeFileSync(join(root, 'applications', 'demo', 'app.yaml'), 'name: demo\n')
    spyOn(paths, 'tryGetRepoRoot').mockReturnValue(root)
    expect(resolveVmAppSelection({ all: true })).toEqual({
      mode: 'all',
      apps: ['demo'],
    })
  })

  test('--all with names dies', () => {
    const die = spyOn(util, 'die').mockImplementation((msg) => {
      throw new Error(msg)
    })
    expect(() => resolveVmAppSelection({ all: true, apps: ['demo'] })).toThrow(/either --all/)
    expect(die).toHaveBeenCalled()
  })
})
