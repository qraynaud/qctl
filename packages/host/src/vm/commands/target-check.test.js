import * as driversMod from '../drivers/index.js'
import * as mod from './target-check.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv, VmDriver } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.loadDriver.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('vm target-check command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('target-check')
  })

  test('handler loads driver and calls check', async () => {
    const check = async () => {}
    const spy = spyOn({ check }, 'check')
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ check: spy })),
    )
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (/** @type {never} */ ({ target: 'local', env: 'dev', name: 'rocky' })),
    )
    expect(spy).toHaveBeenCalled()
  })
})
