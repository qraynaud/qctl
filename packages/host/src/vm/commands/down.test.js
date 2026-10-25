import * as endpointMod from '../../sync/endpoint.js'
import * as waitMod from '../../sync/wait-ssh.js'
import * as driversMod from '../drivers/index.js'
import * as downPipe from '../libs/down-pipeline.js'
import * as appsMod from '../libs/guest-apps.js'
import * as quadletMod from '../libs/guest-quadlet.js'
import * as mod from './down.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.resolveDriver.mockRestore?.()
  // @ts-expect-error restore
  downPipe.runVmDown.mockRestore?.()
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
  test('bare down calls runVmDown', async () => {
    spyOn(appsMod, 'resolveVmAppSelection').mockReturnValue({ mode: 'none' })
    spyOn(driversMod, 'resolveDriver').mockResolvedValue(
      /** @type {never} */ ({
        module: { id: 'workstation' },
        ctx: { name: 'rocky', env: 'dev', timeout: 120, dryRun: false },
      }),
    )
    const spy = spyOn(downPipe, 'runVmDown').mockResolvedValue(undefined)
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ target: 'workstation', env: 'dev', name: 'rocky', timeout: 120 })
      ),
    )
    expect(spy).toHaveBeenCalled()
  })

  test('with apps does not call runVmDown', async () => {
    spyOn(appsMod, 'resolveVmAppSelection').mockReturnValue({
      mode: 'list',
      apps: ['demo'],
    })
    const spy = spyOn(downPipe, 'runVmDown').mockResolvedValue(undefined)
    spyOn(endpointMod, 'resolveSyncEndpoint').mockResolvedValue({
      host: '127.0.0.1',
      port: 2222,
      username: 'rocky',
      remoteDir: '/tank/rocky',
      label: 'x',
    })
    spyOn(waitMod, 'waitForSsh').mockResolvedValue(undefined)
    spyOn(quadletMod, 'guestQuadletDown').mockResolvedValue(undefined)
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {never} */ ({
        target: 'workstation',
        env: 'dev',
        name: 'rocky',
        apps: ['demo'],
      }),
    )
    expect(spy).not.toHaveBeenCalled()
  })
})
