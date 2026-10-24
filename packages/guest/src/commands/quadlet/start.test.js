import * as cliMod from '../../quadlet/cli.js'
import * as lifecycleMod from '../../quadlet/lifecycle.js'
import * as mod from './start.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { QuadletContext } from '../../quadlet/context.js' */

afterEach(() => {
  // @ts-expect-error restore
  cliMod.runQuadletCommand.mockRestore?.()
  // @ts-expect-error restore
  lifecycleMod.runStartStop.mockRestore?.()
})

describe('quadlet start command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('start <apps..>')
    expect(mod.describe).toContain('Start')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler runs runStartStop with start', async () => {
    /** @type {Array<{ action: string, app: string }>} */
    const calls = []
    spyOn(cliMod, 'runQuadletCommand').mockImplementation(async (fn) => {
      await fn(/** @type {QuadletContext} */ ({}))
    })
    spyOn(lifecycleMod, 'runStartStop').mockImplementation((_ctx, action, app) => {
      calls.push({ action, app })
    })
    await mod.handler({ apps: ['web'] })
    expect(calls).toEqual([{ action: 'start', app: 'web' }])
  })
})
