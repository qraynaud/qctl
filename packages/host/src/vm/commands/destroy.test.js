import * as driversMod from '../drivers/index.js'
import * as confirmMod from '../libs/confirm-destroy.js'
import * as mod from './destroy.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv, VmDriver } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.loadDriver.mockRestore?.()
  // @ts-expect-error restore
  confirmMod.confirmProdFullDestroy.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
})

describe('vm destroy command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('destroy')
    expect(mod.describe).toContain('keep-persistent')
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
          keepPersistent: false,
          yes: false,
          dryRun: false,
        })
      ),
    )
    expect(driversMod.loadDriver).toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
  })

  test('dies when -y without --keep-persistent', async () => {
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ destroy: async () => {} })),
    )
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
    const exit = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`)
    })
    await expect(
      mod.handler(
        /** @type {VmArgv} */ (
          /** @type {never} */ ({
            target: 'local',
            env: 'dev',
            name: 'rocky',
            keepPersistent: false,
            yes: true,
            dryRun: false,
          })
        ),
      ),
    ).rejects.toThrow(/exit 1/)
    exit.mockRestore()
  })

  test('prod full wipe always confirms', async () => {
    const destroy = async () => {}
    const spy = spyOn({ destroy }, 'destroy')
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ destroy: spy })),
    )
    const confirm = spyOn(confirmMod, 'confirmProdFullDestroy').mockResolvedValue(undefined)
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({
          target: 'local',
          env: 'prod',
          name: 'rocky',
          keepPersistent: false,
          yes: false,
          dryRun: false,
        })
      ),
    )
    expect(confirm).toHaveBeenCalledWith('rocky')
    expect(spy).toHaveBeenCalled()
  })

  test('prod keep-persistent skips confirm', async () => {
    const destroy = async () => {}
    const spy = spyOn({ destroy }, 'destroy')
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ destroy: spy })),
    )
    const confirm = spyOn(confirmMod, 'confirmProdFullDestroy').mockResolvedValue(undefined)
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({
          target: 'local',
          env: 'prod',
          name: 'rocky',
          keepPersistent: true,
          yes: true,
          dryRun: false,
        })
      ),
    )
    expect(confirm).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
  })
})
