import { z } from 'zod'

import { registriesSchema } from './first-boot.js'
import {
  IFACE_RE,
  namedMapToList,
  parseSecretsSchema,
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

  test('parseSecretsSchema throws a formatted Error', () => {
    expect(() => parseSecretsSchema(z.string().min(5), 'ab', 'test.yaml')).toThrow(/test\.yaml/)
  })

  test('trimmedText accepts string and Buffer from !env', () => {
    expect(trimmedText.parse('  hi  ')).toBe('hi')
    expect(trimmedText.parse(Buffer.from('reg|user|tok', 'utf8'))).toBe('reg|user|tok')
  })

  test('registriesSchema accepts !env Buffer entries', () => {
    const line = 'heptapod.example|ci|$TOKEN'
    expect(registriesSchema.parse([Buffer.from(line, 'utf8'), 'plain|a|b'])).toEqual([
      line,
      'plain|a|b',
    ])
  })

  test('namedMapToList expands maps and rejects arrays', () => {
    /** @type {z.ZodIssue[]} */
    const issues = []
    const ctx = /** @type {z.RefinementCtx} */ (
      /** @type {never} */ ({
        addIssue: (/** @type {z.ZodIssue} */ issue) => {
          issues.push(issue)
        },
        path: [],
      })
    )
    expect(namedMapToList({ ssh: { port: 22 } }, ctx, ['ports'])).toEqual([
      { name: 'ssh', port: 22 },
    ])
    expect(namedMapToList([{ port: 22 }], ctx, ['ports'])).toBe(z.NEVER)
    expect(issues.length).toBeGreaterThan(0)
  })
})
