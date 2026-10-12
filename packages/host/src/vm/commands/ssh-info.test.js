import * as driversMod from '../drivers/index.js'
import * as mod from './ssh-info.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv, VmDriver } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.loadDriver.mockRestore?.()
})

describe('vm ssh-info command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('ssh-info')
  })

  test('handler loads driver and calls sshInfo', async () => {
    const sshInfo = async () => {}
    const spy = spyOn({ sshInfo }, 'sshInfo')
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ sshInfo: spy })),
    )
    await mod.handler(
      /** @type {VmArgv} */ (/** @type {never} */ ({ target: 'local', env: 'dev', name: 'rocky' })),
    )
    expect(spy).toHaveBeenCalled()
  })
})
