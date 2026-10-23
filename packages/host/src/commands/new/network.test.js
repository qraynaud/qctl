import * as promptMod from '../../new/prompt.js'
import * as newMod from '../../new.js'
import * as mod from './network.js'
import { describe, expect, spyOn, test } from 'bun:test'

describe('new network command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('network [name]')
    expect(mod.describe).toContain('networks/')
  })

  test('handler creates a network package with stub', async () => {
    spyOn(promptMod, 'resolveNewNamedPackageOptions').mockResolvedValue({
      name: 'vlan',
      force: false,
    })
    spyOn(newMod, 'newPackage').mockReturnValue({
      root: '/inst',
      path: '/inst/networks/vlan',
      extra: ['vlan.network'],
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({ name: 'vlan', force: false })
    expect(newMod.newPackage).toHaveBeenCalledWith('network', 'vlan', {
      force: false,
      networkStub: true,
    })
  })

  test('handler --empty skips network stub', async () => {
    spyOn(promptMod, 'resolveNewNamedPackageOptions').mockResolvedValue({
      name: 'vlan',
      force: false,
    })
    spyOn(newMod, 'newPackage').mockReturnValue({
      root: '/inst',
      path: '/inst/networks/vlan',
      extra: [],
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({ name: 'vlan', empty: true })
    expect(newMod.newPackage).toHaveBeenCalledWith('network', 'vlan', {
      force: false,
      networkStub: false,
    })
  })
})
