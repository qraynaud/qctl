import * as endpointMod from '../../sync/endpoint.js'
import * as waitMod from '../../sync/wait-ssh.js'
import * as driversMod from '../drivers/index.js'
import * as destroyPipe from '../libs/destroy-pipeline.js'
import * as appsMod from '../libs/guest-apps.js'
import * as quadletMod from '../libs/guest-quadlet.js'
import * as upPipe from '../libs/up-pipeline.js'
import * as mod from './up.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.resolveDriver.mockRestore?.()
  // @ts-expect-error restore
  upPipe.runVmUp.mockRestore?.()
  // @ts-expect-error restore
  destroyPipe.runVmDestroy.mockRestore?.()
  // @ts-expect-error restore
  appsMod.resolveVmAppSelection.mockRestore?.()
  // @ts-expect-error restore
  endpointMod.resolveSyncEndpoint.mockRestore?.()
  // @ts-expect-error restore
  waitMod.waitForSsh.mockRestore?.()
  // @ts-expect-error restore
  quadletMod.guestQuadletUp.mockRestore?.()
  // @ts-expect-error restore
  quadletMod.guestQuadletUpAll.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

const fakeResolved = {
  module: { id: 'workstation' },
  ctx: {
    name: 'rocky',
    env: 'dev',
    timeout: 2700,
    dryRun: false,
  },
}

describe('vm up command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('up [apps..]')
    expect(mod.describe).toMatch(/quadlet/i)
  })

  test('handler resolveDriver + runVmUp (VM only)', async () => {
    spyOn(driversMod, 'resolveDriver').mockResolvedValue(/** @type {never} */ (fakeResolved))
    const spy = spyOn(upPipe, 'runVmUp').mockResolvedValue(undefined)
    spyOn(appsMod, 'resolveVmAppSelection').mockReturnValue({ mode: 'none' })
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ target: 'workstation', env: 'dev', name: 'rocky', profile: 'lab' })
      ),
    )
    expect(spy).toHaveBeenCalled()
  })

  test('handler waits for SSH then guestQuadletUp when apps given', async () => {
    spyOn(driversMod, 'resolveDriver').mockResolvedValue(/** @type {never} */ (fakeResolved))
    spyOn(upPipe, 'runVmUp').mockResolvedValue(undefined)
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
    const wait = spyOn(waitMod, 'waitForSsh').mockResolvedValue(undefined)
    const qUp = spyOn(quadletMod, 'guestQuadletUp').mockResolvedValue(undefined)
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
    expect(wait).toHaveBeenCalled()
    expect(qUp).toHaveBeenCalled()
  })
})
