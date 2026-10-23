import * as sshMod from './ssh.js'
import { waitForSsh } from './wait-ssh.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  sshMod.sshConnect.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('waitForSsh', () => {
  test('resolves when sshConnect succeeds', async () => {
    const end = () => {}
    spyOn(sshMod, 'sshConnect').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof sshMod.sshConnect>>} */ (/** @type {never} */ ({ end })),
    )
    spyOn(console, 'log').mockImplementation(() => {})
    await waitForSsh({
      host: '127.0.0.1',
      port: 2222,
      username: 'rocky',
      timeoutSec: 5,
      pollMs: 10,
    })
    expect(sshMod.sshConnect).toHaveBeenCalled()
  })

  test('throws with vm up hint after timeout', async () => {
    spyOn(sshMod, 'sshConnect').mockRejectedValue(new Error('ECONNREFUSED'))
    spyOn(console, 'log').mockImplementation(() => {})
    await expect(
      waitForSsh({
        host: '127.0.0.1',
        port: 2222,
        username: 'rocky',
        timeoutSec: 0.05,
        pollMs: 10,
      }),
    ).rejects.toThrow(/vm up/)
  })
})
