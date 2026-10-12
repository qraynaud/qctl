import * as util from '../../../lib/util.js'
import * as libvirt from '../../libs/libvirt/index.js'
import { down } from './down.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  util.requireBins.mockRestore?.()
  // @ts-expect-error restore
  libvirt.domainExists.mockRestore?.()
  // @ts-expect-error restore
  libvirt.domainState.mockRestore?.()
  // @ts-expect-error restore
  libvirt.setDomainSerialNull.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('local down', () => {
  test('dry-run logs and returns', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await down(
      /** @type {VmArgv} */ ({
        connect: 'qemu:///system',
        name: 'rocky',
        dryRun: true,
        timeout: 30,
        force: false,
      }),
    )
    expect(String(log.mock.calls[0]?.[0])).toMatch(/would shut down/)
  })

  test('already shut off resets serial and returns', async () => {
    spyOn(util, 'requireBins').mockResolvedValue(undefined)
    spyOn(libvirt, 'domainExists').mockResolvedValue(true)
    spyOn(libvirt, 'domainState').mockResolvedValue('shut off')
    const serial = spyOn(libvirt, 'setDomainSerialNull').mockResolvedValue(true)
    spyOn(console, 'log').mockImplementation(() => {})
    await down(
      /** @type {VmArgv} */ ({
        connect: 'qemu:///system',
        name: 'rocky',
        dryRun: false,
        timeout: 30,
        force: false,
      }),
    )
    expect(serial).toHaveBeenCalledWith('qemu:///system', 'rocky')
  })
})
