import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import { clearAppReady, isAppReady, setAppReady } from './stamps.js'
import { describe, expect, test } from 'bun:test'

describe('supervisor stamps', () => {
  test('set / is / clear ready under runDir', () => {
    const runDir = join(makeTempDir(), 'run')
    expect(isAppReady('web', runDir)).toBe(false)
    setAppReady('web', runDir)
    expect(isAppReady('web', runDir)).toBe(true)
    clearAppReady('web', runDir)
    expect(isAppReady('web', runDir)).toBe(false)
  })
})
