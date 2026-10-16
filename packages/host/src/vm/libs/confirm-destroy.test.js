import { confirmProdFullDestroy } from './confirm-destroy.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
})

describe('confirmProdFullDestroy', () => {
  test('dies without a TTY', async () => {
    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    spyOn(console, 'error').mockImplementation(() => {})
    const exit = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`)
    })
    try {
      await expect(confirmProdFullDestroy('rocky')).rejects.toThrow(/exit 1/)
    } finally {
      if (stdinDesc) Object.defineProperty(process.stdin, 'isTTY', stdinDesc)
      else delete (/** @type {{ isTTY?: boolean }} */ (process.stdin).isTTY)
      exit.mockRestore()
    }
  })
})
