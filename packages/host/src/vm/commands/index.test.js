import { vmCommands } from './index.js'
import { describe, expect, test } from 'bun:test'

describe('vmCommands registry', () => {
  test('exports lifecycle subcommands in order', () => {
    expect(vmCommands.map((c) => c.command)).toEqual([
      'seed',
      'download',
      'up',
      'down',
      'destroy',
      'init-tank',
      'status',
      'ssh-info',
      'target-check',
    ])
  })

  test('each entry has describe, builder, and handler', () => {
    for (const c of vmCommands) {
      expect(typeof c.describe).toBe('string')
      expect(typeof c.builder).toBe('function')
      expect(typeof c.handler).toBe('function')
    }
  })
})
