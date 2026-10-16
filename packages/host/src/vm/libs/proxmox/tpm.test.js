import { rockyTpmstate } from './tpm.js'
import { describe, expect, test } from 'bun:test'

describe('rockyTpmstate', () => {
  test('formats storage-backed TPM 2.0 volume', () => {
    expect(rockyTpmstate('local-lvm')).toBe('local-lvm:1,version=v2.0')
  })
})
