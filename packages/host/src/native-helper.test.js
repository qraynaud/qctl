import { embeddedNativeHelperPath, ensureHostNativeHelper } from './native-helper.js'
import { describe, expect, test } from 'bun:test'

describe('host native-helper', () => {
  test('embeddedNativeHelperPath points at varlock-local-encrypt', () => {
    expect(embeddedNativeHelperPath()).toMatch(/varlock-local-encrypt$/)
  })

  test('ensureHostNativeHelper resolves or returns null without throwing', async () => {
    const path = await ensureHostNativeHelper()
    expect(path === null || typeof path === 'string').toBe(true)
  })
})
