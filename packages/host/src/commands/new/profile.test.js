import * as promptMod from '../../new/prompt.js'
import * as mod from './profile.js'
import { describe, expect, spyOn, test } from 'bun:test'

describe('new profile command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('profile [name]')
    expect(mod.describe).toMatch(/profile|Proxmox/i)
  })

  test('handler scaffolds a profile', async () => {
    spyOn(promptMod, 'resolveNewProfileOptions').mockResolvedValue({
      name: 'pve',
      force: false,
      yes: true,
      env: 'dev',
      target: 'proxmox',
      setDefault: false,
      skipOverlays: true,
      overlays: null,
    })
    spyOn(promptMod, 'scaffoldNewProfile').mockReturnValue({
      root: '/inst',
      name: 'pve',
      env: 'dev',
      target: 'proxmox',
      written: ['provision/profile-pve.yaml'],
      skipped: [],
      overlayWritten: false,
    })
    spyOn(promptMod, 'formatNewProfileOutro').mockReturnValue('outro')
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({ name: 'pve', yes: true, env: 'dev', target: 'proxmox' })
    expect(promptMod.scaffoldNewProfile).toHaveBeenCalled()
    expect(process.exitCode ?? 0).toBe(0)
  })
})
