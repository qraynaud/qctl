import { errMessage, which } from './util.js'
import { describe, expect, test } from 'bun:test'

describe('host lib util', () => {
  test('errMessage unwraps Error and stringifies other values', () => {
    expect(errMessage(new Error('boom'))).toBe('boom')
    expect(errMessage('plain')).toBe('plain')
    expect(errMessage(42)).toBe('42')
  })

  test('which finds bash and misses a fake binary', async () => {
    expect(await which('bash')).toMatch(/bash/)
    expect(await which('qctl-no-such-bin-xyz')).toBeNull()
  })
})
