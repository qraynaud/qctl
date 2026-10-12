import {
  GUEST_FATAL_ERROR,
  isGuestFatalError,
  makeGuestFatalError,
  waitForSuccessOrGuestFatal,
} from './guest-fatal.js'
import { describe, expect, test } from 'bun:test'

describe('guest-fatal', () => {
  test('makeGuestFatalError / isGuestFatalError', () => {
    const err = makeGuestFatalError('boom')
    expect(err.name).toBe(GUEST_FATAL_ERROR)
    expect(err.message).toBe('boom')
    expect(isGuestFatalError(err)).toBe(true)
    expect(isGuestFatalError(new Error('x'))).toBe(false)
    expect(isGuestFatalError('x')).toBe(false)
  })

  test('waitForSuccessOrGuestFatal: no console → only waitUntilStopped', async () => {
    /** @type {AbortSignal[]} */
    const signals = []
    await waitForSuccessOrGuestFatal({
      waitUntilStopped: async (signal) => {
        signals.push(signal)
      },
      signal: new AbortController().signal,
      consoleFollow: null,
    })
    expect(signals).toHaveLength(1)
  })

  test('waitForSuccessOrGuestFatal: shutoff wins before fatal', async () => {
    let resolveFatal = /** @type {(v: { line: string }) => void} */ (() => {})
    const fatalPromise = new Promise((resolve) => {
      resolveFatal = resolve
    })
    await waitForSuccessOrGuestFatal({
      waitUntilStopped: async () => {},
      signal: new AbortController().signal,
      consoleFollow: {
        result: fatalPromise,
        stop: async () => {},
      },
    })
    // Shutoff already won; resolving fatal later must not throw unhandled.
    resolveFatal({ line: 'late' })
    await Promise.resolve()
  })

  test('waitForSuccessOrGuestFatal: fatal wins and aborts wait', async () => {
    await expect(
      waitForSuccessOrGuestFatal({
        waitUntilStopped: async (signal) => {
          await new Promise((_, reject) => {
            const onAbort = () => {
              reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
            }
            if (signal.aborted) {
              onAbort()
              return
            }
            signal.addEventListener('abort', onAbort, { once: true })
          })
        },
        signal: new AbortController().signal,
        consoleFollow: {
          result: Promise.resolve({ status: /** @type {const} */ ('fail'), line: 'fatal line' }),
          stop: async () => {},
        },
      }),
    ).rejects.toMatchObject({ name: GUEST_FATAL_ERROR, message: 'fatal line' })
  })
})
