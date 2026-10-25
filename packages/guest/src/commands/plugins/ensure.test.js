import * as shared from '@qctl/shared'
import { makeTempDir, removeTempDir, writeFile } from '@qctl/shared/test-helpers'

import * as contextMod from '../../supervisor/quadlet/context.js'
import * as mod from './ensure.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  // @ts-expect-error restore
  shared.ensurePackageDependencies.mockRestore?.()
  // @ts-expect-error restore
  contextMod.resolveInstanceRoot.mockRestore?.()
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
    expect(mod.describe).toContain('package.json')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler exits 1 when dir is missing', async () => {
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({ dir: '/no/such/plugins-scan' })
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })

  test('handler defaults to resolveInstanceRoot when --dir omitted', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    writeFile(dir, 'package.json', JSON.stringify({ name: 'inst', private: true }))
    spyOn(contextMod, 'resolveInstanceRoot').mockReturnValue(dir)
    spyOn(shared, 'ensurePackageDependencies').mockResolvedValue({
      root: dir,
      installed: false,
      frozen: true,
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({})
    expect(contextMod.resolveInstanceRoot).toHaveBeenCalled()
    expect(shared.ensurePackageDependencies).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({ frozen: true }),
    )
  })

  test('handler installs package deps for an instance root', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    writeFile(dir, 'package.json', JSON.stringify({ name: 'inst', private: true }))
    spyOn(shared, 'ensurePackageDependencies').mockResolvedValue({
      root: dir,
      installed: true,
      frozen: true,
    })
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })
    await mod.handler({ dir })
    expect(shared.ensurePackageDependencies).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({ env: process.env, frozen: true, qctlEnv: expect.any(String) }),
    )
    expect(lines.some((l) => l.includes('installed deps') && l.includes('frozen'))).toBe(true)
  })
})
