import yargs from 'yargs'

import * as mod from './vm.js'
import { describe, expect, test } from 'bun:test'

describe('vm command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('vm')
    expect(mod.describe).toContain('VM')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('builder registers vm lifecycle subcommands', async () => {
    const help = await mod.builder(yargs().scriptName('qctl')).getHelp()
    for (const name of ['up', 'down', 'destroy', 'seed', 'status']) {
      expect(help).toMatch(new RegExp(`\\b${name}\\b`))
    }
  })
})
