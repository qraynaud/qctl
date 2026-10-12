import * as driversMod from '../drivers/index.js'
import * as mod from './init-tank.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv, VmDriver } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.loadDriver.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('vm init-tank command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('init-tank')
    expect(mod.describe).toContain('tank')
  })

  test('handler loads driver and calls initTank', async () => {
    const initTank = async () => {}
    const spy = spyOn({ initTank }, 'initTank')
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ initTank: spy })),
    )
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (/** @type {never} */ ({ target: 'local', env: 'dev', name: 'rocky' })),
    )
    expect(spy).toHaveBeenCalled()
  })
})
