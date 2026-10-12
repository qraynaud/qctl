import * as driversMod from '../drivers/index.js'
import * as mod from './destroy.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv, VmDriver } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.loadDriver.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('vm destroy command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('destroy')
    expect(mod.describe).toContain('Undefine')
    expect(typeof mod.builder).toBe('function')
  })

  test('handler loads driver and calls destroy', async () => {
    const destroy = async () => {}
    const spy = spyOn({ destroy }, 'destroy')
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ destroy: spy })),
    )
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({
          target: 'local',
          env: 'dev',
          name: 'rocky',
          keepData: false,
        })
      ),
    )
    expect(driversMod.loadDriver).toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
  })
})
