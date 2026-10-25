import * as mod from './app-proxy.js'
import { describe, expect, test } from 'bun:test'

describe('_internal_app_proxy command', () => {
  test('exports internal command shape', () => {
    expect(mod.command).toBe('_internal_app_proxy <app>')
    expect(mod.internal).toBe(true)
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })
})
