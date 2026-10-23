import * as driversMod from '../drivers/index.js'
import * as mod from './down.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv, VmDriver } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.loadDriver.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('vm down command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('down')
    expect(mod.describe).toContain('ACPI')
  })

  test('handler loads driver and calls down', async () => {
    const down = async () => {}
    const spy = spyOn({ down }, 'down')
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ down: spy })),
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
