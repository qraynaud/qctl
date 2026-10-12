import * as shared from '@qctl/shared'
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import * as mod from './ensure.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  // @ts-expect-error restore
  shared.ensureNpmPluginsFromDir.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('plugins ensure command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('ensure')
    expect(mod.describe).toContain('@plugin')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler exits 1 when dir is missing', async () => {
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({ dir: ['/no/such/plugins-scan'] })
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })

  test('handler ensures pins from an existing dir', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    spyOn(shared, 'ensureNpmPluginsFromDir').mockResolvedValue({
      pins: [{ moduleName: 'foo', version: '1.0.0', descriptor: 'foo@1.0.0' }],
      cached: ['/tmp/cache/foo'],
    })
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })
    await mod.handler({ dir: [dir] })
    expect(shared.ensureNpmPluginsFromDir).toHaveBeenCalledWith(dir)
    expect(lines.some((l) => l.includes('foo@1.0.0'))).toBe(true)
  })
})
