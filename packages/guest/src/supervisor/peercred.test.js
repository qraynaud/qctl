import { unlinkSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import { getPeerCred } from './peercred.js'
import { describe, expect, test } from 'bun:test'

/** @import { PeerCred } from './peercred.js' */

describe('getPeerCred', () => {
  test('reads uid/gid/pid from an accepted unix connection', async () => {
    const sockPath = join(makeTempDir(), 'peer.sock')
    /** @type {PeerCred | undefined} */
    let seen
    const server = net.createServer((c) => {
      seen = getPeerCred(c)
      c.end()
    })
    await new Promise((/** @type {(v?: void) => void} */ resolve, reject) => {
      server.once('error', reject)
      server.listen(sockPath, () => resolve())
    })
    try {
      await new Promise((/** @type {(v?: void) => void} */ resolve, reject) => {
        const c = net.connect(sockPath)
        c.on('connect', () => {})
        c.on('close', () => resolve())
        c.on('error', reject)
      })
      expect(seen).toBeDefined()
      const uid = process.getuid?.()
      const gid = process.getgid?.()
      expect(typeof uid).toBe('number')
      expect(typeof gid).toBe('number')
      expect(seen?.uid).toBe(uid)
      expect(seen?.gid).toBe(gid)
      expect(typeof seen?.pid).toBe('number')
      expect(seen?.pid).toBeGreaterThan(0)
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)))
      try {
        unlinkSync(sockPath)
      } catch {
        // ignore
      }
    }
  })

  test('throws when socket has no fd', () => {
    expect(() => getPeerCred({})).toThrow(/missing socket fd/)
  })
})
