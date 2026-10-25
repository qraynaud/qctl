import { z } from 'zod'

import { INSTALLED, defineFlag, jsonCodec } from './flags.js'
import { describe, expect, test } from 'bun:test'

describe('defineFlag / jsonCodec', () => {
  test('rejects invalid names', () => {
    expect(() => defineFlag('Bad', z.boolean())).toThrow(/must match/)
    expect(() => defineFlag('qctl.installed', z.boolean())).toThrow(/must match/)
  })

  test('INSTALLED carries boolean schema; wire via jsonCodec', () => {
    expect(INSTALLED.name).toBe('installed')
    expect(INSTALLED.schema).toBeInstanceOf(z.ZodBoolean)
    const wire = jsonCodec(INSTALLED.schema)
    expect(wire.encode(true)).toBe('true')
    expect(wire.encode(false)).toBe('false')
    expect(wire.decode('true')).toBe(true)
    expect(wire.decode('false')).toBe(false)
  })

  test('jsonCodec rejects invalid JSON', () => {
    const c = jsonCodec(z.boolean())
    expect(() => c.decode('not-json')).toThrow()
  })
})
