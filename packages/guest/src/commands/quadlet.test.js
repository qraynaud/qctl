import yargs from 'yargs'

import * as mod from './quadlet.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('quadlet')
    expect(mod.describe).toContain('Quadlet')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('builder registers lifecycle subcommands', async () => {
    const y = mod.builder(yargs().scriptName('qctl'))
    const help = await y.getHelp()
    for (const sub of ['up', 'down', 'enable', 'start', 'stop', 'restart', 'ps']) {
      expect(help).toMatch(new RegExp(`\\b${sub}\\b`))
    }
  })
})
