import * as cliMod from '../../quadlet/cli.js'
import * as upMod from '../../quadlet/up/index.js'
import * as mod from './up.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { QuadletContext } from '../../quadlet/context.js' */

afterEach(() => {
  // @ts-expect-error restore
  cliMod.runQuadletCommand.mockRestore?.()
  // @ts-expect-error restore
  upMod.runUp.mockRestore?.()
})

describe('quadlet up command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('up [apps..]')
    expect(mod.describe).toContain('Reconcile')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler runs runUp with dry-run and app filter', async () => {
    spyOn(cliMod, 'runQuadletCommand').mockImplementation(async (fn) => {
      await fn(/** @type {QuadletContext} */ ({}))
    })
    const runUp = spyOn(upMod, 'runUp').mockImplementation(async () => {})
    await mod.handler({ apps: ['web'], dryRun: true })
    expect(runUp).toHaveBeenCalledWith({}, { dryRun: true, apps: ['web'] })
  })

  test('handler omits apps when none given', async () => {
    spyOn(cliMod, 'runQuadletCommand').mockImplementation(async (fn) => {
      await fn(/** @type {QuadletContext} */ ({}))
    })
    const runUp = spyOn(upMod, 'runUp').mockImplementation(async () => {})
    await mod.handler({ dryRun: false })
    expect(runUp).toHaveBeenCalledWith({}, { dryRun: false, apps: undefined })
  })
})
