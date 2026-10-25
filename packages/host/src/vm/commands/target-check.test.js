import * as driversMod from '../drivers/index.js'
import * as checkPipe from '../libs/check-pipeline.js'
import * as mod from './target-check.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.resolveDriver.mockRestore?.()
  // @ts-expect-error restore
  checkPipe.runVmCheck.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('vm target-check command', () => {
  test('handler resolveDriver + runVmCheck', async () => {
    spyOn(driversMod, 'resolveDriver').mockResolvedValue(
      /** @type {never} */ ({
        module: { id: 'workstation' },
        ctx: { name: 'rocky', env: 'dev', timeout: 1, dryRun: false },
      }),
    )
    const spy = spyOn(checkPipe, 'runVmCheck').mockResolvedValue(true)
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ target: 'workstation', env: 'dev', name: 'rocky' })
      ),
    )
    expect(spy).toHaveBeenCalled()
  })
})
