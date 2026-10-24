import * as cliMod from '../../quadlet/cli.js'
import * as lifecycleMod from '../../quadlet/lifecycle.js'
import * as mod from './stop.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { QuadletContext } from '../../quadlet/context.js' */

afterEach(() => {
  // @ts-expect-error restore
  cliMod.runQuadletCommand.mockRestore?.()
  // @ts-expect-error restore
  lifecycleMod.runStartStop.mockRestore?.()
})

describe('quadlet stop command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('stop <apps..>')
    expect(mod.describe).toContain('Stop')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler runs runStartStop with stop', async () => {
    spyOn(cliMod, 'runQuadletCommand').mockImplementation(async (fn) => {
      await fn(/** @type {QuadletContext} */ ({}))
    })
    const runStartStop = spyOn(lifecycleMod, 'runStartStop').mockImplementation(() => {})
    await mod.handler({ apps: ['dbroot'] })
    expect(runStartStop).toHaveBeenCalledWith({}, 'stop', 'dbroot')
  })
})
