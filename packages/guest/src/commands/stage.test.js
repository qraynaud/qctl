import { UnknownStageError } from '../init/errors.js'
import * as runStageMod from '../init/run-stage.js'
import * as mod from './stage.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  runStageMod.runStage.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
})

describe('stage command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('stage <name>')
    expect(mod.describe).toContain('init stage')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler runs the named stage', async () => {
    const runStage = spyOn(runStageMod, 'runStage').mockResolvedValue(undefined)
    await mod.handler({ name: 'network-up', profile: 'default', dryRun: false })
    expect(runStage).toHaveBeenCalledWith(
      'network-up',
      expect.objectContaining({ profile: 'default' }),
    )
  })

  test('handler sets exitCode on unknown stage', async () => {
    spyOn(runStageMod, 'runStage').mockRejectedValue(new UnknownStageError('nope'))
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({ name: 'nope' })
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
