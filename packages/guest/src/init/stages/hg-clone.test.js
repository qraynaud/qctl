import { createTestContext, testOsConfig } from '../context.test-helpers.js'
import { StageError } from '../errors.js'
import hgClone from './hg-clone.js'
import { describe, expect, test } from 'bun:test'

describe('hg-clone stage', () => {
  test('exports name and plan', () => {
    expect(hgClone.name).toBe('hg-clone')
    const ctx = createTestContext({
      osConfig: testOsConfig({ root: '/tank/x' }),
      log: () => {},
    })
    expect(hgClone.plan(ctx).join('\n')).toMatch(/hg clone/)
  })

  test('run requires root', async () => {
    const ctx = createTestContext({
      osConfig: testOsConfig({ repo: { vcs: 'hg' } }),
      log: () => {},
      isRoot: () => false,
    })
    await expect(hgClone.run(ctx)).rejects.toBeInstanceOf(StageError)
  })

  test('run rejects non-hg vcs', async () => {
    const ctx = createTestContext({
      osConfig: testOsConfig({ repo: { vcs: 'git' } }),
      log: () => {},
      isRoot: () => true,
    })
    await expect(hgClone.run(ctx)).rejects.toThrow(/not supported/)
  })
})
