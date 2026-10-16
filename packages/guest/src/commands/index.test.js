import { commands } from './index.js'
import { describe, expect, test } from 'bun:test'

describe('guest commands registry', () => {
  test('exports static command modules in order', () => {
    expect(commands.map((c) => c.command)).toEqual([
      'init',
      'list',
      'stage <name>',
      'plugins',
      'quadlet',
      'secret',
    ])
  })

  test('each entry has describe, builder, and handler', () => {
    for (const c of commands) {
      expect(typeof c.describe).toBe('string')
      expect(typeof c.builder).toBe('function')
      expect(typeof c.handler).toBe('function')
    }
  })

  test('marks first-boot / debug commands as internal', () => {
    const byCmd = Object.fromEntries(commands.map((c) => [String(c.command).split(' ')[0], c]))
    expect(byCmd.init?.internal).toBe(true)
    expect(byCmd.list?.internal).toBe(true)
    expect(byCmd.stage?.internal).toBe(true)
    expect(byCmd.plugins?.internal).toBe(true)
    expect(byCmd.quadlet?.internal).toBe(false)
    expect(byCmd.secret?.internal).toBe(false)
  })
})
