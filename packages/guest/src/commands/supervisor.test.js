import * as mod from './supervisor.js'
import { describe, expect, test } from 'bun:test'

describe('_internal_supervisor command', () => {
  test('exports internal command shape', () => {
    expect(mod.command).toBe('_internal_supervisor')
    expect(mod.internal).toBe(true)
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })
})
