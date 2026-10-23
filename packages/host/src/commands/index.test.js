import { commands } from './index.js'
import { describe, expect, test } from 'bun:test'

describe('host commands registry', () => {
  test('happy-path order: init → vm → new → sync → local → seed-kit', () => {
    expect(commands.map((c) => c.command)).toEqual([
      'init [dir]',
      'vm',
      'new',
      'sync',
      'local',
      'seed-kit',
    ])
  })

  test('local is advanced; seed-kit is advanced', () => {
    const local = commands.find((c) => c.command === 'local')
    const seedKit = commands.find((c) => c.command === 'seed-kit')
    expect(local?.describe).toMatch(/advanced/i)
    expect(seedKit?.describe).toMatch(/advanced/i)
  })
})
