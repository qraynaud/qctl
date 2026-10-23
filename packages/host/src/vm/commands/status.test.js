import * as driversMod from '../drivers/index.js'
import * as mod from './status.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv, VmDriver } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.loadDriver.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('vm status command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('status')
  })

  test('handler loads driver and calls status', async () => {
    const status = async () => {}
    const spy = spyOn({ status }, 'status')
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ status: spy })),
    )
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ target: 'workstation', env: 'dev', name: 'rocky' })
      ),
    )
    expect(spy).toHaveBeenCalled()
  })
})
