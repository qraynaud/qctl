import * as endpointMod from '../../sync/endpoint.js'
import * as driversMod from '../drivers/index.js'
import * as quadletMod from '../libs/guest-quadlet.js'
import * as powerMod from '../libs/power-state.js'
import * as mod from './ps.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv, VmDriver } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.loadDriver.mockRestore?.()
  // @ts-expect-error restore
  powerMod.resolveVmPowerState.mockRestore?.()
  // @ts-expect-error restore
  endpointMod.resolveSyncEndpoint.mockRestore?.()
  // @ts-expect-error restore
  quadletMod.guestQuadletPs.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
})

describe('vm ps command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('ps [apps..]')
    expect(mod.describe).toMatch(/quadlet/i)
  })

  test('handler skips guest when VM is not running', async () => {
    const driver = /** @type {VmDriver} */ (/** @type {never} */ ({ id: 'workstation' }))
    spyOn(driversMod, 'loadDriver').mockResolvedValue(driver)
    spyOn(powerMod, 'resolveVmPowerState').mockResolvedValue({ kind: 'absent' })
    const ep = spyOn(endpointMod, 'resolveSyncEndpoint')
    const ps = spyOn(quadletMod, 'guestQuadletPs')
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((...a) => {
      lines.push(a.map(String).join(' '))
    })
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ target: 'workstation', env: 'dev', name: 'rocky', profile: 'lab' })
      ),
    )
    expect(ep).not.toHaveBeenCalled()
    expect(ps).not.toHaveBeenCalled()
    expect(lines.some((l) => l.includes('qctl vm up'))).toBe(true)
  })

  test('handler runs guestQuadletPs when VM is running', async () => {
    const driver = /** @type {VmDriver} */ (/** @type {never} */ ({ id: 'workstation' }))
    spyOn(driversMod, 'loadDriver').mockResolvedValue(driver)
    spyOn(powerMod, 'resolveVmPowerState').mockResolvedValue({
      kind: 'running',
      detail: 'running',
    })
    spyOn(endpointMod, 'resolveSyncEndpoint').mockResolvedValue({
      host: '127.0.0.1',
      port: 2222,
      username: 'rocky',
      remoteDir: '/tank/rocky',
      label: 'rocky@127.0.0.1:2222',
    })
    const ps = spyOn(quadletMod, 'guestQuadletPs').mockResolvedValue(0)
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
    expect(ps).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1' }), ['demo'])
  })
})
