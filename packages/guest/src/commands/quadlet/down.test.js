import * as cliMod from '../../quadlet/cli.js'
import * as lifecycleMod from '../../quadlet/lifecycle.js'
import * as mod from './down.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { QuadletContext } from '../../quadlet/context.js' */

afterEach(() => {
  // @ts-expect-error restore
  cliMod.runQuadletCommand.mockRestore?.()
  // @ts-expect-error restore
  lifecycleMod.runDown.mockRestore?.()
})

describe('quadlet down command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('down <apps..>')
    expect(mod.describe).toContain('Stop')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler runs runDown for each app', async () => {
    /** @type {string[]} */
    const downed = []
    spyOn(cliMod, 'runQuadletCommand').mockImplementation(async (_argv, fn) => {
      await fn(/** @type {QuadletContext} */ ({}))
    })
    spyOn(lifecycleMod, 'runDown').mockImplementation((_ctx, app) => {
      downed.push(app)
    })
    await mod.handler({ apps: ['web', 'db'] })
    expect(downed).toEqual(['web', 'db'])
  })
})
