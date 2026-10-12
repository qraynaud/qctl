import { ensureImportContent, sizeToGiB } from './vm-images.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { ProxmoxClient } from './client.js' */

afterEach(() => {
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('vm-images', () => {
  test('sizeToGiB converts common units', () => {
    expect(sizeToGiB('2G')).toBe(2)
    expect(sizeToGiB('2048M')).toBe(2)
    expect(sizeToGiB('512M')).toBe(1)
  })

  test('sizeToGiB dies on bad input', () => {
    spyOn(process, 'exit').mockImplementation(
      /** @returns {never} */ () => {
        throw new Error('exit')
      },
    )
    spyOn(console, 'error').mockImplementation(() => {})
    expect(() => sizeToGiB('nope')).toThrow(/exit/)
  })

  test('ensureImportContent skips when import already present', async () => {
    const client = {
      get: async () => ({ content: 'iso,import', digest: 'abc' }),
      put: async () => {
        throw new Error('should not put')
      },
    }
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await ensureImportContent(/** @type {ProxmoxClient} */ (/** @type {never} */ (client)), 'local')
    expect(String(log.mock.calls[0]?.[0])).toMatch(/already has import/)
  })
})
