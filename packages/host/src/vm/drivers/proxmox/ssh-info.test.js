import { sshInfo } from './ssh-info.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('proxmox sshInfo', () => {
  test('prints Proxmox SSH hints', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await sshInfo(
      /** @type {VmArgv} */ ({
        name: 'rocky-dev',
      }),
    )
    const joined = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(joined).toMatch(/Shell \(Proxmox\)/)
    expect(joined).toMatch(/qctl vm shell --host/)
    expect(joined).toMatch(/rocky-dev/)
  })
})
