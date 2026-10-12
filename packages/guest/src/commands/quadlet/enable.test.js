import * as cliMod from '../../quadlet/cli.js'
import * as enableMod from '../../quadlet/enable.js'
import * as mod from './enable.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { QuadletContext } from '../../quadlet/context.js' */

afterEach(() => {
  // @ts-expect-error restore
  cliMod.runQuadletCommand.mockRestore?.()
  // @ts-expect-error restore
  enableMod.runEnable.mockRestore?.()
})

describe('quadlet enable command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('enable <apps..>')
    expect(mod.describe).toContain('units')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler runs runEnable with install flag', async () => {
    /** @type {Array<{ app: string, install: boolean }>} */
    const calls = []
    spyOn(cliMod, 'runQuadletCommand').mockImplementation(async (_argv, fn) => {
      await fn(/** @type {QuadletContext} */ ({}))
    })
    spyOn(enableMod, 'runEnable').mockImplementation(async (_ctx, opts) => {
      calls.push({ app: opts.app, install: opts.install ?? false })
    })
    await mod.handler({ apps: ['web'], install: false })
    expect(calls).toEqual([{ app: 'web', install: false }])
  })
})
