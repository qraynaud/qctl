import net from 'node:net'

import {
  isAbortError,
  sleep,
  tcpPortOpen,
  waitForLocalTcpPorts,
  waitForSerialOutcome,
} from './wait.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
})

describe('wait helpers', () => {
  test('sleep and isAbortError', async () => {
    const t0 = Date.now()
    await sleep(20)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15)
    expect(isAbortError(Object.assign(new Error('Aborted'), { name: 'AbortError' }))).toBe(true)
    expect(isAbortError(new Error('x'))).toBe(false)
  })

  test('tcpPortOpen detects listening port', async () => {
    const server = net.createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    expect(await tcpPortOpen('127.0.0.1', port)).toBe(true)
    expect(await tcpPortOpen('127.0.0.1', 1)).toBe(false)
    await new Promise((resolve) => server.close(() => resolve(undefined)))
  })

  test('waitForSerialOutcome returns ok from follow', async () => {
    spyOn(console, 'log').mockImplementation(() => {})
    const outcome = await waitForSerialOutcome(
      { result: Promise.resolve({ status: 'ok', line: 'ready' }) },
      5,
      undefined,
      { waiting: 'waiting', timeoutLine: 'timeout' },
    )
    expect(outcome).toEqual({ status: 'ok', line: 'ready' })
  })

  test('waitForLocalTcpPorts no-ops on empty ports', async () => {
    await waitForLocalTcpPorts({ ports: [] })
  })
})
