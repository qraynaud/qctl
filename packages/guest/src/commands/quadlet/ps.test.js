import * as cliMod from '../../quadlet/cli.js'
import * as lifecycleMod from '../../quadlet/lifecycle.js'
import * as mod from './ps.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { QuadletContext } from '../../quadlet/context.js' */

afterEach(() => {
  // @ts-expect-error restore
  cliMod.runQuadletCommand.mockRestore?.()
  // @ts-expect-error restore
  lifecycleMod.runPs.mockRestore?.()
})

describe('quadlet ps command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('ps [apps..]')
    expect(mod.describe).toContain('containers')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler passes app filter when apps are given', async () => {
    spyOn(cliMod, 'runQuadletCommand').mockImplementation(async (fn) => {
      await fn(/** @type {QuadletContext} */ ({}))
    })
    const runPs = spyOn(lifecycleMod, 'runPs').mockImplementation(() => {})
    await mod.handler({ apps: ['web'] })
    expect(runPs).toHaveBeenCalledWith({}, ['web'])
  })

  test('handler lists all when apps omitted', async () => {
    spyOn(cliMod, 'runQuadletCommand').mockImplementation(async (fn) => {
      await fn(/** @type {QuadletContext} */ ({}))
    })
    const runPs = spyOn(lifecycleMod, 'runPs').mockImplementation(() => {})
    await mod.handler({})
    expect(runPs).toHaveBeenCalledWith({}, undefined)
  })
})
