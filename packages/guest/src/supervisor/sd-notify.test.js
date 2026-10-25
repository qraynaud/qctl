import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import { sdNotify } from './sd-notify.js'
import { describe, expect, test } from 'bun:test'

describe('sdNotify', () => {
  test('returns false when NOTIFY_SOCKET unset', async () => {
    const prev = process.env.NOTIFY_SOCKET
    delete process.env.NOTIFY_SOCKET
    try {
      expect(await sdNotify('READY=1')).toBe(false)
    } finally {
      if (prev !== undefined) process.env.NOTIFY_SOCKET = prev
    }
  })

  test('uses systemd-notify (Bun has no unix_dgram)', async () => {
    const sock = join(makeTempDir(), 'missing.sock')
    await expect(sdNotify('READY=1', { socketPath: sock })).rejects.toThrow(/systemd-notify failed/)
  })
})
