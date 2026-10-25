import * as driversMod from '../drivers/index.js'
import * as confirmMod from '../libs/confirm-destroy.js'
import * as destroyPipe from '../libs/destroy-pipeline.js'
import * as resolveDisks from '../libs/resolve-provision-disks.js'
import * as mod from './destroy.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  driversMod.resolveDriver.mockRestore?.()
  // @ts-expect-error restore
  destroyPipe.runVmDestroy.mockRestore?.()
  // @ts-expect-error restore
  confirmMod.confirmProdFullDestroy.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
})

const resolved = {
  module: { id: 'workstation' },
  ctx: { name: 'rocky', env: 'dev', timeout: 1, dryRun: false },
}

describe('vm destroy command', () => {
  test('handler resolveDriver + runVmDestroy', async () => {
    spyOn(driversMod, 'resolveDriver').mockResolvedValue(/** @type {never} */ (resolved))
    spyOn(resolveDisks, 'resolveProvisionDisks').mockResolvedValue(
      /** @type {never} */ ({
        os: { id: 'os' },
        members: [
          { id: 'os', kind: 'os' },
          { id: 'rocky-data0', kind: 'tank' },
        ],
      }),
    )
    const spy = spyOn(destroyPipe, 'runVmDestroy').mockResolvedValue(undefined)
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({
          target: 'workstation',
          env: 'dev',
          name: 'rocky',
          keepPersistent: true,
          yes: true,
        })
      ),
    )
    expect(driversMod.resolveDriver).toHaveBeenCalled()
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ keepDisks: ['rocky-data0'] }),
      expect.anything(),
    )
  })

  test('dies when --yes without --keep-persistent', async () => {
    spyOn(driversMod, 'resolveDriver').mockResolvedValue(/** @type {never} */ (resolved))
    spyOn(process, 'exit').mockImplementation(
      /** @returns {never} */ () => {
        throw new Error('exit')
      },
    )
    spyOn(console, 'error').mockImplementation(() => {})
    spyOn(console, 'log').mockImplementation(() => {})
    await expect(
      mod.handler(
        /** @type {never} */ ({
          target: 'workstation',
          env: 'dev',
          name: 'rocky',
          yes: true,
          keepPersistent: false,
        }),
      ),
    ).rejects.toThrow(/exit/)
  })

  test('production full wipe confirms', async () => {
    spyOn(driversMod, 'resolveDriver').mockResolvedValue(/** @type {never} */ (resolved))
    const confirm = spyOn(confirmMod, 'confirmProdFullDestroy').mockResolvedValue(undefined)
    const spy = spyOn(destroyPipe, 'runVmDestroy').mockResolvedValue(undefined)
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {never} */ ({
        target: 'workstation',
        env: 'prod',
        name: 'rocky',
        production: true,
        dryRun: false,
        keepPersistent: false,
      }),
    )
    expect(confirm).toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
  })

  test('production dry-run skips confirm', async () => {
    spyOn(driversMod, 'resolveDriver').mockResolvedValue(
      /** @type {never} */ ({
        ...resolved,
        ctx: { ...resolved.ctx, dryRun: true },
      }),
    )
    const confirm = spyOn(confirmMod, 'confirmProdFullDestroy').mockResolvedValue(undefined)
    spyOn(destroyPipe, 'runVmDestroy').mockResolvedValue(undefined)
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler(
      /** @type {never} */ ({
        target: 'workstation',
        env: 'prod',
        name: 'rocky',
        production: true,
        dryRun: true,
        keepPersistent: false,
      }),
    )
    expect(confirm).not.toHaveBeenCalled()
  })
})
