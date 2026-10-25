import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import {
  clearAppReady,
  isAppFailed,
  isAppReady,
  setAppFailed,
  setAppReady,
  waitAppReady,
  watchAppUntilNotReady,
} from './stamps.js'
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

  test('failed clears ready; wait/watch see failed', async () => {
    const runDir = join(makeTempDir(), 'run')
    setAppReady('web', runDir)
    setAppFailed('web', runDir)
    expect(isAppReady('web', runDir)).toBe(false)
    expect(isAppFailed('web', runDir)).toBe(true)
    expect(await waitAppReady('web', { runDir, timeoutMs: 200, pollMs: 20 })).toBe('failed')

    setAppReady('web', runDir)
    const watching = watchAppUntilNotReady('web', { runDir, pollMs: 20 })
    setAppFailed('web', runDir)
    expect(await watching).toBe('failed')

    setAppReady('web', runDir)
    expect(isAppFailed('web', runDir)).toBe(false)
  })
})
