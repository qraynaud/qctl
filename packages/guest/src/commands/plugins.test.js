import yargs from 'yargs'

import * as mod from './plugins.js'
import { describe, expect, test } from 'bun:test'

describe('plugins command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('plugins')
    expect(mod.describe).toContain('plugins-cache')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('builder registers ensure subcommand', async () => {
    const y = mod.builder(yargs().scriptName('qctl'))
    const help = await y.getHelp()
    expect(help).toMatch(/\bensure\b/)
  })
})
