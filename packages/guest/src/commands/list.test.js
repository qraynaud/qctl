import { DEFAULT_STAGES } from '../init/stages.js'
import * as mod from './list.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('list command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('list')
    expect(mod.describe).toContain('init stages')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler prints stages for default profile', async () => {
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })
    await mod.handler({ profile: 'default' })
    expect(lines).toEqual([...DEFAULT_STAGES])
  })
})
