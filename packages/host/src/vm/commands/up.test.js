import * as driversMod from '../drivers/index.js'
import * as mod from './up.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv, VmDriver } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.loadDriver.mockRestore?.()
})

describe('vm up command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('up')
  })

  test('handler loads driver and calls up', async () => {
    const up = async () => {}
    const spy = spyOn({ up }, 'up')
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ up: spy })),
    )
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ target: 'workstation', env: 'dev', name: 'rocky' })
      ),
    )
    expect(spy).toHaveBeenCalled()
  })
})
