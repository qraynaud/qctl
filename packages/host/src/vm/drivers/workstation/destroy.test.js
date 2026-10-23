import * as paths from '../../../lib/paths.js'
import * as util from '../../../lib/util.js'
import * as libvirt from '../../libs/libvirt/index.js'
import * as resolveDisks from '../../libs/resolve-provision-disks.js'
import { destroy, destroyVm } from './destroy.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

const sampleResolved = {
  os: { id: 'os', size: '20G' },
  data: { vw: { id: 'vw', mount: '/vw', fs: 'xfs', size: '2G' } },
  tanks: {},
  members: [
    { id: 'os', kind: /** @type {const} */ ('os'), size: '20G' },
    { id: 'vw', kind: /** @type {const} */ ('data'), size: '2G', owner: 'vw' },
  ],
  encryptedTankIds: [],
}

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
  resolveDisks.resolveProvisionDisks.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('workstation destroy', () => {
  test('destroyVm dry-run logs and returns', async () => {
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    spyOn(resolveDisks, 'resolveProvisionDisks').mockResolvedValue(sampleResolved)
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await destroyVm({
      connect: 'qemu:///system',
      name: 'rocky',
      keepPersistent: false,
      dryRun: true,
      env: 'dev',
      target: 'workstation',
    })
    expect(log).toHaveBeenCalled()
    expect(String(log.mock.calls[0]?.[0])).toMatch(/would destroy/)
  })

  test('destroy removes domain when present', async () => {
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    spyOn(resolveDisks, 'resolveProvisionDisks').mockResolvedValue(sampleResolved)
    spyOn(util, 'requireBins').mockResolvedValue(undefined)
    spyOn(libvirt, 'domainExists').mockResolvedValue(true)
    const remove = spyOn(libvirt, 'removeDomain').mockResolvedValue(true)
    spyOn(console, 'log').mockImplementation(() => {})
    await destroy(
      /** @type {VmArgv} */ ({
        connect: 'qemu:///system',
        name: 'rocky',
        keepPersistent: true,
        dryRun: false,
        env: 'dev',
        target: 'workstation',
      }),
    )
    expect(remove).toHaveBeenCalledWith('qemu:///system', 'rocky')
  })
})
