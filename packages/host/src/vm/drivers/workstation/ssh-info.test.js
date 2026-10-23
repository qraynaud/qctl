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

describe('workstation sshInfo', () => {
  test('requires virsh and prints ssh hints', async () => {
    spyOn(util, 'requireBins').mockResolvedValue(undefined)
    spyOn(options, 'portsFromArgv').mockReturnValue({
      ssh: { port: 22, forward: 2222 },
      cockpit: { port: 9090, forward: 9090 },
    })
    const print = spyOn(sshHints, 'printLocalSshInfo').mockResolvedValue(undefined)
    const argv = /** @type {VmArgv} */ ({
      connect: 'qemu:///system',
      name: 'rocky',
      network: 'user',
      env: 'dev',
      target: 'workstation',
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
