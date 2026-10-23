import * as profileArgv from '../../lib/profile-argv.js'
import * as endpointMod from '../../sync/endpoint.js'
import * as sshMod from '../../sync/ssh.js'
import * as mod from './shell.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

afterEach(() => {
  process.exitCode = 0
})

describe('vm shell command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('shell')
    expect(mod.describe).toMatch(/SSH|shell/i)
  })

  test('handler resolves endpoint and opens interactive shell', async () => {
    spyOn(profileArgv, 'resolveProfileArgv').mockImplementation((argv) => {
      argv.target = 'workstation'
      argv.env = 'dev'
      argv.profile = 'lab'
      return argv
    })
    spyOn(endpointMod, 'resolveSyncEndpoint').mockResolvedValue({
      host: '127.0.0.1',
      port: 2222,
      username: 'rocky',
      remoteDir: '/tank/rocky',
      label: 'rocky@127.0.0.1:2222',
    })
    const shell = spyOn(sshMod, 'sshInteractiveShell').mockResolvedValue(0)
    spyOn(console, 'log').mockImplementation(() => {})

    await mod.handler(
      /** @type {VmArgv} */ (/** @type {never} */ ({ network: 'user', connect: 'qemu:///system' })),
    )

    expect(shell).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 2222,
      username: 'rocky',
      identity: undefined,
    })
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('handler prints proxmox --host requirement from resolveSyncEndpoint', async () => {
    spyOn(profileArgv, 'resolveProfileArgv').mockImplementation((argv) => {
      argv.target = 'proxmox'
      argv.env = 'dev'
      argv.profile = 'pve'
      return argv
    })
    spyOn(endpointMod, 'resolveSyncEndpoint').mockRejectedValue(
      new Error('proxmox sync needs --host <guest-ip>'),
    )
    /** @type {string[]} */
    const errs = []
    spyOn(console, 'error').mockImplementation((line) => {
      errs.push(String(line))
    })

    await mod.handler(/** @type {VmArgv} */ (/** @type {never} */ ({})))
    expect(process.exitCode).toBe(1)
    expect(errs.some((l) => /--host/i.test(l))).toBe(true)
  })
})
