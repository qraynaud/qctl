import { embeddedNativeHelperPath, ensureGuestNativeHelper } from './native-helper.js'
import { describe, expect, test } from 'bun:test'

describe('guest native-helper', () => {
  test('embeddedNativeHelperPath points at varlock-local-encrypt next to this module', () => {
    expect(embeddedNativeHelperPath()).toMatch(/varlock-local-encrypt$/)
  })

  test('ensureGuestNativeHelper resolves or returns null without throwing', async () => {
    const path = await ensureGuestNativeHelper()
    expect(path === null || typeof path === 'string').toBe(true)
  })
})
