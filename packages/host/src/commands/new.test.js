import yargs from 'yargs'

import * as mod from './new.js'
import { describe, expect, test } from 'bun:test'

describe('new command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('new')
    expect(mod.describe).toContain('Scaffold')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('builder registers app/common/network/env/profile', async () => {
    const help = await mod.builder(yargs().scriptName('qctl')).getHelp()
    for (const name of ['app', 'common', 'network', 'env', 'profile']) {
      expect(help).toMatch(new RegExp(`\\b${name}\\b`))
    }
    expect(help).toMatch(/Proxmox|profile/i)
  })
})
