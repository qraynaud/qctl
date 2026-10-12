import yargs from 'yargs'

import * as mod from './secret.js'
import { describe, expect, test } from 'bun:test'

describe('secret command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('secret')
    expect(mod.describe).toContain('Podman secrets')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('builder registers check and sync subcommands', async () => {
    const y = mod.builder(yargs().scriptName('qctl'))
    const help = await y.getHelp()
    expect(help).toMatch(/\bcheck\b/)
    expect(help).toMatch(/\bsync\b/)
  })
})
