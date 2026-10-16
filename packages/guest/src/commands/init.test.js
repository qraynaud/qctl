import * as runMod from '../init/run.js'
import * as mod from './init.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  runMod.runInit.mockRestore?.()
  process.exitCode = 0
})

describe('init command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('_internal_init')
    expect(mod.describe).toContain('First-boot')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler delegates to runInit', async () => {
    const runInit = spyOn(runMod, 'runInit').mockResolvedValue(0)
    await mod.handler({ profile: 'init-tank', dryRun: true, from: 'tier0-seal' })
    expect(runInit).toHaveBeenCalledWith({
      profile: 'init-tank',
      dryRun: true,
      from: 'tier0-seal',
    })
  })

  test('handler sets exitCode when runInit returns non-zero', async () => {
    spyOn(runMod, 'runInit').mockResolvedValue(3)
    await mod.handler({})
    expect(process.exitCode).toBe(3)
  })
})
