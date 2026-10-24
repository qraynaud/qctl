import * as cidataMod from '../init/cidata.js'
import { testOsConfig } from '../init/context.test-helpers.js'
import { UnknownStageError } from '../init/errors.js'
import * as runStageMod from '../init/run-stage.js'
import * as osConfigMod from '../os-config.js'
import * as mod from './stage.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  runStageMod.runStage.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  // @ts-expect-error restore
  cidataMod.openCidata.mockRestore?.()
  // @ts-expect-error restore
  osConfigMod.tryReadOsConfig.mockRestore?.()
  process.exitCode = 0
})

/** Fall back to `/etc/qctl/config.json` (no cidata) with a known OS config. */
function stubOsConfigOnly() {
  spyOn(cidataMod, 'openCidata').mockRejectedValue(new Error('no cidata'))
  spyOn(osConfigMod, 'tryReadOsConfig').mockReturnValue(testOsConfig({ root: '/tank/stage-test' }))
  spyOn(console, 'log').mockImplementation(() => {})
}

describe('stage command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('_internal_stage <name>')
    expect(mod.describe).toContain('init stage')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler runs the named stage', async () => {
    stubOsConfigOnly()
    const runStage = spyOn(runStageMod, 'runStage').mockResolvedValue(undefined)
    await mod.handler({ name: 'network-up', profile: 'default', dryRun: false })
    expect(runStage).toHaveBeenCalledWith(
      'network-up',
      expect.objectContaining({
        profile: 'default',
        osConfig: expect.objectContaining({ root: '/tank/stage-test' }),
        secrets: expect.any(Object),
      }),
    )
    const ctx = runStage.mock.calls[0][1]
    expect('env' in ctx).toBe(false)
  })

  test('handler sets exitCode on unknown stage', async () => {
    stubOsConfigOnly()
    spyOn(runStageMod, 'runStage').mockRejectedValue(new UnknownStageError('nope'))
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({ name: 'nope' })
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
