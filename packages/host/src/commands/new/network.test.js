import * as newMod from '../../new.js'
import * as mod from './network.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  newMod.newPackage.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  process.exitCode = 0
})

describe('new network command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('network <name>')
    expect(mod.describe).toContain('networks/')
  })

  test('handler creates a network package', async () => {
    spyOn(newMod, 'newPackage').mockReturnValue({ root: '/inst', path: '/inst/networks/vlan' })
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({ name: 'vlan', force: false })
    expect(newMod.newPackage).toHaveBeenCalledWith('network', 'vlan', { force: false })
  })
})
