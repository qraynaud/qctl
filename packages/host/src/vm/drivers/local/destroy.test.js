import * as paths from '../../../lib/paths.js'
import * as util from '../../../lib/util.js'
import * as libvirt from '../../libs/libvirt/index.js'
import { destroy, destroyVm } from './destroy.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  util.requireBins.mockRestore?.()
  // @ts-expect-error restore
  libvirt.domainExists.mockRestore?.()
  // @ts-expect-error restore
  libvirt.removeDomain.mockRestore?.()
  // @ts-expect-error restore
  paths.getVms.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('local destroy', () => {
  test('destroyVm dry-run logs and returns', async () => {
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await destroyVm({
      connect: 'qemu:///system',
      name: 'rocky',
      keepData: false,
      dryRun: true,
    })
    expect(log).toHaveBeenCalled()
    expect(String(log.mock.calls[0]?.[0])).toMatch(/would destroy/)
  })

  test('destroy removes domain when present', async () => {
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    spyOn(util, 'requireBins').mockResolvedValue(undefined)
    spyOn(libvirt, 'domainExists').mockResolvedValue(true)
    const remove = spyOn(libvirt, 'removeDomain').mockResolvedValue(true)
    spyOn(console, 'log').mockImplementation(() => {})
    await destroy(
      /** @type {VmArgv} */ ({
        connect: 'qemu:///system',
        name: 'rocky',
        keepData: true,
        dryRun: false,
      }),
    )
    expect(remove).toHaveBeenCalledWith('qemu:///system', 'rocky')
  })
})
