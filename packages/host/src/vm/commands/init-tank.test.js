import * as driversMod from '../drivers/index.js'
import * as upPipe from '../libs/up-pipeline.js'
import * as mod from './init-tank.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.resolveDriver.mockRestore?.()
  // @ts-expect-error restore
  upPipe.runVmUp.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('vm init-tank command', () => {
  test('handler resolveDriver + runVmInitTank', async () => {
    spyOn(driversMod, 'resolveDriver').mockResolvedValue(
      /** @type {never} */ ({
        module: { id: 'workstation' },
        ctx: { name: 'rocky', env: 'dev', timeout: 1, dryRun: false },
      }),
    )
    const spy = spyOn(upPipe, 'runVmInitTank').mockResolvedValue(undefined)
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ target: 'workstation', env: 'dev', name: 'rocky' })
      ),
    )
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0]?.[1]?.console).toBe(true)
  })
})
