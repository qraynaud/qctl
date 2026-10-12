import { commands } from './index.js'
import { describe, expect, test } from 'bun:test'

describe('host commands registry', () => {
  test('exports static command modules in order', () => {
    expect(commands.map((c) => c.command)).toEqual([
      'init [dir]',
      'new',
      'sync',
      'vm',
      'seed-kit',
      'local',
    ])
  })

  test('each entry has describe, builder, and handler', () => {
    for (const c of commands) {
      expect(typeof c.describe).toBe('string')
      expect(typeof c.builder).toBe('function')
      expect(typeof c.handler).toBe('function')
    }
  })
})
