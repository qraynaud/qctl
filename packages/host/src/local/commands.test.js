import { localCommands } from './commands.js'
import { describe, expect, test } from 'bun:test'

describe('localCommands registry', () => {
  test('exports subcommands in order', () => {
    expect(localCommands.map((c) => c.command)).toEqual([
      'up [apps..]',
      'test <apps..>',
      'down [apps..]',
      'shell',
      'ps [apps..]',
      'logs [apps..]',
    ])
  })

  test('each entry has describe, builder, and handler', () => {
    for (const c of localCommands) {
      expect(typeof c.describe).toBe('string')
      expect(typeof c.builder).toBe('function')
      expect(typeof c.handler).toBe('function')
    }
  })
})
