import yargs from 'yargs'

import * as mod from './local.js'
import { describe, expect, test } from 'bun:test'

describe('local command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('local')
    expect(mod.describe).toMatch(/Podman|advanced|without a VM/i)
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('builder registers local subcommands', async () => {
    const help = await mod.builder(yargs().scriptName('qctl')).getHelp()
    for (const name of ['up', 'down', 'shell', 'ps', 'logs', 'test']) {
      expect(help).toMatch(new RegExp(`\\b${name}\\b`))
    }
  })
})
