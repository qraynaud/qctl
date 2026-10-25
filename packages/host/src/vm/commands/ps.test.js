import * as endpointMod from '../../sync/endpoint.js'
import * as driversMod from '../drivers/index.js'
import * as quadletMod from '../libs/guest-quadlet.js'
import * as powerMod from '../libs/power-state.js'
import * as mod from './ps.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.resolveDriver.mockRestore?.()
  // @ts-expect-error restore
  powerMod.powerStateFromModule.mockRestore?.()
  // @ts-expect-error restore
  endpointMod.resolveSyncEndpoint.mockRestore?.()
  // @ts-expect-error restore
  quadletMod.guestQuadletPs.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
})

describe('vm ps command', () => {
  test('prints running and probes guest when power running', async () => {
    spyOn(driversMod, 'resolveDriver').mockResolvedValue(
      /** @type {never} */ ({
        module: { id: 'workstation', powerState: async () => ({ kind: 'running' }) },
        ctx: { name: 'rocky', env: 'dev', timeout: 1, dryRun: false },
      }),
    )
    spyOn(powerMod, 'powerStateFromModule').mockResolvedValue({ kind: 'running' })
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
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ target: 'workstation', env: 'dev', name: 'rocky' })
      ),
    )
    expect(ps).toHaveBeenCalled()
  })

  test('skips guest when stopped', async () => {
    spyOn(driversMod, 'resolveDriver').mockResolvedValue(
      /** @type {never} */ ({
        module: { id: 'workstation', powerState: async () => ({ kind: 'stopped' }) },
        ctx: { name: 'rocky', env: 'dev', timeout: 1, dryRun: false },
      }),
    )
    spyOn(powerMod, 'powerStateFromModule').mockResolvedValue({
      kind: 'stopped',
      detail: 'shut off',
    })
    const ps = spyOn(quadletMod, 'guestQuadletPs').mockResolvedValue(0)
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ target: 'workstation', env: 'dev', name: 'rocky' })
      ),
    )
    expect(ps).not.toHaveBeenCalled()
  })
})
