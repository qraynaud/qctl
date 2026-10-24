import * as cliMod from '../../quadlet/cli.js'
import * as lifecycleMod from '../../quadlet/lifecycle.js'
import * as mod from './restart.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { QuadletContext } from '../../quadlet/context.js' */

afterEach(() => {
  // @ts-expect-error restore
  cliMod.runQuadletCommand.mockRestore?.()
  // @ts-expect-error restore
  lifecycleMod.runRestart.mockRestore?.()
})

describe('quadlet restart command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('restart <apps..>')
    expect(mod.describe).toContain('Restart')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler runs runRestart for each app', async () => {
    /** @type {string[]} */
    const restarted = []
    spyOn(cliMod, 'runQuadletCommand').mockImplementation(async (fn) => {
      await fn(/** @type {QuadletContext} */ ({}))
    })
    spyOn(lifecycleMod, 'runRestart').mockImplementation((_ctx, app) => {
      restarted.push(app)
    })
    await mod.handler({ apps: ['proxy'] })
    expect(restarted).toEqual(['proxy'])
  })
})
