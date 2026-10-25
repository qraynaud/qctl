import { unlinkSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import { SupervisorUnavailableError, supervisorRequest } from './client.js'
import { describe, expect, test } from 'bun:test'

/** @import { Socket } from 'node:net' */

/**
 * @param {string} sockPath
 * @param {(c: Socket) => void} onConn
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
async function listen(sockPath, onConn) {
  /** @type {Set<Socket>} */
  const conns = new Set()
  const server = net.createServer((c) => {
    conns.add(c)
    c.on('close', () => conns.delete(c))
    onConn(c)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(sockPath, () => resolve(undefined))
  })
  return {
    close: async () => {
      for (const c of conns) {
        try {
          c.destroy()
        } catch {
          // ignore
        }
      }
      await new Promise((resolve) => server.close(() => resolve(undefined)))
      try {
        unlinkSync(sockPath)
      } catch {
        // ignore
      }
    },
  }
}

describe('supervisor client', () => {
  test('ENOENT → SupervisorUnavailableError with sock path', async () => {
    const missing = join(makeTempDir(), 'gone.sock')
    try {
      await supervisorRequest(missing, { method: 'status', params: { app: 'web' } })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(SupervisorUnavailableError)
      expect(/** @type {SupervisorUnavailableError} */ (err).sockPath).toBe(missing)
      expect(String(err)).toMatch(/qctl-supervisor not running/)
    }
  })

  test('timeout when server never replies', async () => {
    const sockPath = join(makeTempDir(), 'slow.sock')
    const srv = await listen(sockPath, (c) => {
      void c
    })
    try {
      await supervisorRequest(
        sockPath,
        { method: 'status', params: { app: 'web' } },
        { timeoutMs: 50 },
      )
      expect.unreachable()
    } catch (err) {
      expect(String(err)).toMatch(/timeout/)
    } finally {
      await srv.close()
    }
  })

  test('rejects invalid response JSON object', async () => {
    const sockPath = join(makeTempDir(), 'bad.sock')
    const srv = await listen(sockPath, (c) => {
      c.write('{"hello":1}\n')
      c.end()
    })
    try {
      await supervisorRequest(sockPath, { method: 'status', params: { app: 'web' } })
      expect.unreachable()
    } catch (err) {
      expect(String(err)).toMatch(/Invalid option|invalid|Unrecognized|expected/i)
    } finally {
      await srv.close()
    }
  })

  test('accepts a valid ok response', async () => {
    const sockPath = join(makeTempDir(), 'ok.sock')
    const srv = await listen(sockPath, (c) => {
      c.on('data', () => {
        c.write('{"ok":true,"result":{"stub":true,"method":"status","app":"web"}}\n')
        c.end()
      })
    })
    try {
      const res = await supervisorRequest(sockPath, {
        method: 'status',
        params: { app: 'web' },
      })
      expect(res).toEqual({
        ok: true,
        result: { stub: true, method: 'status', app: 'web' },
      })
    } finally {
      await srv.close()
    }
  })
})
