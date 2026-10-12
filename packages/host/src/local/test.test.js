import * as mod from './test.js'
import { describe, expect, test } from 'bun:test'

describe('local test command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('test <apps..>')
    expect(mod.describe).toContain('disposable')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })
})
