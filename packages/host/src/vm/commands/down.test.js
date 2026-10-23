import * as endpointMod from '../../sync/endpoint.js'
import * as waitMod from '../../sync/wait-ssh.js'
import * as driversMod from '../drivers/index.js'
import * as appsMod from '../libs/guest-apps.js'
import * as quadletMod from '../libs/guest-quadlet.js'
import * as mod from './down.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv, VmDriver } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.loadDriver.mockRestore?.()
  // @ts-expect-error restore
  appsMod.resolveVmAppSelection.mockRestore?.()
  // @ts-expect-error restore
  endpointMod.resolveSyncEndpoint.mockRestore?.()
  // @ts-expect-error restore
  waitMod.waitForSsh.mockRestore?.()
  // @ts-expect-error restore
  quadletMod.guestQuadletDown.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('vm down command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('down [apps..]')
    expect(mod.describe).toMatch(/ACPI|quadlet/i)
  })

  test('handler loads driver and calls down when no apps', async () => {
    const down = async () => {}
    const spy = spyOn({ down }, 'down')
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ down: spy })),
    )
    spyOn(appsMod, 'resolveVmAppSelection').mockReturnValue({ mode: 'none' })
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ target: 'workstation', env: 'dev', name: 'rocky', profile: 'lab' })
      ),
    )
    expect(spy).toHaveBeenCalled()
  })

  test('handler quadlet-downs apps without ACPI', async () => {
    const down = async () => {}
    const spy = spyOn({ down }, 'down')
    spyOn(driversMod, 'loadDriver').mockResolvedValue(
      /** @type {VmDriver} */ (/** @type {never} */ ({ down: spy })),
    )
    spyOn(appsMod, 'resolveVmAppSelection').mockReturnValue({
      mode: 'list',
      apps: ['demo'],
    })
    spyOn(endpointMod, 'resolveSyncEndpoint').mockResolvedValue({
      host: '127.0.0.1',
      port: 2222,
      username: 'rocky',
      remoteDir: '/tank/rocky',
      label: 'rocky@127.0.0.1:2222',
    })
    spyOn(waitMod, 'waitForSsh').mockResolvedValue(undefined)
    const qDown = spyOn(quadletMod, 'guestQuadletDown').mockResolvedValue(undefined)
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {never} */ ({
        target: 'workstation',
        env: 'dev',
        name: 'rocky',
        profile: 'lab',
        apps: ['demo'],
      }),
    )
    expect(spy).not.toHaveBeenCalled()
    expect(qDown).toHaveBeenCalled()
  })
})
