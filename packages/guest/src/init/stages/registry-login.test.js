import { createTestContext } from '../context.test-helpers.js'
import registryLogin, {
  parseContainerRegistryValue,
  parseRegistriesJson,
} from './registry-login.js'
import { describe, expect, test } from 'bun:test'

describe('parseContainerRegistryValue', () => {
  test('parses registry|username|token', () => {
    expect(parseContainerRegistryValue('ghcr.io|u|tok|extra')).toEqual({
      registry: 'ghcr.io',
      user: 'u',
      token: 'tok|extra',
    })
  })

  test('empty → null; malformed → throw', () => {
    expect(parseContainerRegistryValue('')).toBeNull()
    expect(() => parseContainerRegistryValue('no-pipes')).toThrow(/want registry/)
    expect(() => parseContainerRegistryValue('a|b')).toThrow(/want registry/)
  })
})

describe('parseRegistriesJson', () => {
  test('parses JSON array', () => {
    expect(parseRegistriesJson('["ghcr.io|a|b"]')).toEqual(['ghcr.io|a|b'])
    expect(parseRegistriesJson('')).toEqual([])
  })
})

describe('registry-login stage', () => {
  test('logs skip when ROCKY_REGISTRIES empty', async () => {
    /** @type {string[]} */
    const logs = []
    const ctx = createTestContext({
      log: (l) => logs.push(l),
      isRoot: () => true,
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })
    await registryLogin.run(ctx)
    expect(logs.some((l) => l.includes('no ROCKY_REGISTRIES'))).toBe(true)
  })

  test('logs in for each registry line', async () => {
    /** @type {string[]} */
    const calls = []
    /** @type {string[]} */
    const logs = []
    const ctx = createTestContext({
      secrets: { ROCKY_REGISTRIES: JSON.stringify(['ghcr.io|alice|secret']) },
      log: (l) => logs.push(l),
      isRoot: () => true,
      exec: async (argv) => {
        calls.push(argv.join(' '))
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    await registryLogin.run(ctx)
    expect(logs.some((l) => l.includes('ghcr.io') && l.includes('registries[0]'))).toBe(true)
    expect(calls.length).toBe(2) // root + apps
    expect(logs.some((l) => l.includes('registered 1'))).toBe(true)
  })
})
