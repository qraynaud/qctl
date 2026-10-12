import * as options from '../../../lib/options.js'
import * as util from '../../../lib/util.js'
import * as sshHints from '../../libs/ssh-hints.js'
import { sshInfo } from './ssh-info.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  util.requireBins.mockRestore?.()
  // @ts-expect-error restore
  options.portsFromArgv.mockRestore?.()
  // @ts-expect-error restore
  sshHints.printLocalSshInfo.mockRestore?.()
})

describe('local sshInfo', () => {
  test('requires virsh and prints ssh hints', async () => {
    spyOn(util, 'requireBins').mockResolvedValue(undefined)
    spyOn(options, 'portsFromArgv').mockReturnValue([])
    const print = spyOn(sshHints, 'printLocalSshInfo').mockResolvedValue(undefined)
    const argv = /** @type {VmArgv} */ ({
      connect: 'qemu:///system',
      name: 'rocky',
      network: 'user',
      env: 'dev',
      target: 'local',
    })
    await sshInfo(argv)
    expect(print).toHaveBeenCalledWith(
      expect.objectContaining({
        connect: 'qemu:///system',
        name: 'rocky',
        network: 'user',
      }),
    )
  })
})
