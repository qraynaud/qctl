import { z } from 'zod'

import { registriesSchema } from './first-boot.js'
import {
  IFACE_RE,
  formatProvisionError,
  mapWithIdDefault,
  optionalTrimmedId,
  optionalTrimmedText,
  trimmedText,
  withRootPath,
} from './zod-utils.js'
import { describe, expect, test } from 'bun:test'

describe('zod-utils', () => {
  test('IFACE_RE accepts linux-ish names', () => {
    expect(IFACE_RE.test('eth0')).toBe(true)
    expect(IFACE_RE.test('0bad')).toBe(false)
  })

  test('withRootPath prefixes issue paths', () => {
    const err = new z.ZodError([{ code: 'custom', message: 'x', path: ['port'] }])
    const wrapped = withRootPath(err, ['networking', 'ports'])
    expect(wrapped.issues[0].path).toEqual(['networking', 'ports', 'port'])
  })

  test('formatProvisionError labels the source', () => {
    const err = z.string().min(5).safeParse('ab')
    expect(err.success).toBe(false)
    if (err.success) return
    expect(formatProvisionError(err.error, 'test.yaml')).toMatch(/test\.yaml/)
  })

  test('trimmedText accepts string and Buffer from !env', () => {
    expect(trimmedText.parse('  hi  ')).toBe('hi')
    expect(trimmedText.parse(Buffer.from('reg|user|tok', 'utf8'))).toBe('reg|user|tok')
  })

  test('optionalTrimmedText maps empty / omitted to undefined', () => {
    expect(optionalTrimmedText.parse(undefined)).toBeUndefined()
    expect(optionalTrimmedText.parse('')).toBeUndefined()
    expect(optionalTrimmedText.parse('  ')).toBeUndefined()
    expect(optionalTrimmedText.parse('  hi  ')).toBe('hi')
  })

  test('registriesSchema accepts !env Buffer entries', () => {
    const line = 'heptapod.example|ci|$TOKEN'
    expect(registriesSchema.parse([Buffer.from(line, 'utf8'), 'plain|a|b'])).toEqual([
      line,
      'plain|a|b',
    ])
  })

  test('optionalTrimmedId: omit / blank → undefined; otherwise trimmed', () => {
    expect(optionalTrimmedId.parse(undefined)).toBeUndefined()
    expect(optionalTrimmedId.parse('')).toBeUndefined()
    expect(optionalTrimmedId.parse('  ')).toBeUndefined()
    expect(optionalTrimmedId.parse('  serial-1  ')).toBe('serial-1')
  })

  test('mapWithIdDefault fills id from map key when omitted', () => {
    const schema = mapWithIdDefault(
      z.strictObject({
        id: optionalTrimmedId,
        mount: z.string().trim().min(1),
      }),
    )
    expect(schema.parse({ vw: { mount: '/vw' } })).toEqual({
      vw: { id: 'vw', mount: '/vw' },
    })
    expect(schema.parse({ vw: { id: 'real-serial', mount: '/vw' } })).toEqual({
      vw: { id: 'real-serial', mount: '/vw' },
    })
    expect(schema.parse({ vw: { id: '', mount: '/vw' } })).toEqual({
      vw: { id: 'vw', mount: '/vw' },
    })
  })

  test('mapWithIdDefault honours a custom key schema', () => {
    const schema = mapWithIdDefault(
      z.strictObject({ id: optionalTrimmedId, size: z.string().optional() }),
      z.string().regex(/^rocky-/),
    )
    expect(schema.parse({ 'rocky-data0': { size: '2G' } })).toEqual({
      'rocky-data0': { id: 'rocky-data0', size: '2G' },
    })
    expect(() => schema.parse({ data0: {} })).toThrow()
  })
})
