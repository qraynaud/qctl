import yargs from 'yargs'

import * as mod from './seed-kit.js'
import { describe, expect, test } from 'bun:test'

describe('seed-kit command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('seed-kit')
    expect(mod.describe).toContain('seed kit')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('builder registers path and export', async () => {
    const help = await mod.builder(yargs().scriptName('qctl')).getHelp()
    expect(help).toMatch(/\bpath\b/)
    expect(help).toMatch(/\bexport\b/)
  })
})
