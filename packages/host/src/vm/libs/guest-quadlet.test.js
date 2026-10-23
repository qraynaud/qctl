import * as sshMod from '../../sync/ssh.js'
import {
  guestQuadletDown,
  guestQuadletPs,
  guestQuadletUp,
  guestQuadletUpAll,
} from './guest-quadlet.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { SyncEndpoint } from '../../sync/endpoint.js' */

const ep = /** @type {SyncEndpoint} */ ({
  host: '127.0.0.1',
  port: 2222,
  username: 'rocky',
  remoteDir: '/tank/rocky',
  label: 'rocky@127.0.0.1:2222',
})

afterEach(() => {
  // @ts-expect-error restore
  sshMod.withSsh.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('guestQuadlet', () => {
  test('guestQuadletUp runs ensure + qctl quadlet up over SSH', async () => {
    /** @type {string[]} */
    const cmds = []
    spyOn(sshMod, 'withSsh').mockImplementation(async (_opts, fn) => {
      await fn(
        /** @type {never} */ (
          {
            /* unused — sshExecOk mocked */
          }
        ),
      )
    })
    spyOn(sshMod, 'sshExecOk').mockImplementation(async (_conn, cmd) => {
      cmds.push(cmd)
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await guestQuadletUp(ep, ['demo'])
    expect(cmds.some((c) => c.includes('mkdir -p') && c.includes('/tank/rocky/volumes'))).toBe(true)
    expect(cmds.some((c) => c.includes('qctl quadlet up --root') && c.includes("'demo'"))).toBe(
      true,
    )
  })

  test('guestQuadletUpAll runs unfiltered up', async () => {
    /** @type {string[]} */
    const cmds = []
    spyOn(sshMod, 'withSsh').mockImplementation(async (_opts, fn) => {
      await fn(/** @type {never} */ ({}))
    })
    spyOn(sshMod, 'sshExecOk').mockImplementation(async (_conn, cmd) => {
      cmds.push(cmd)
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await guestQuadletUpAll(ep)
    expect(cmds.at(-1)).toMatch(/qctl quadlet up --root/)
    expect(cmds.at(-1)).not.toMatch(/qctl quadlet up --root \S+ \w/)
  })

  test('guestQuadletDown runs quadlet down', async () => {
    /** @type {string[]} */
    const cmds = []
    spyOn(sshMod, 'withSsh').mockImplementation(async (_opts, fn) => {
      await fn(/** @type {never} */ ({}))
    })
    spyOn(sshMod, 'sshExec').mockImplementation(async (_conn, cmd) => {
      cmds.push(cmd)
      return { code: 0, stdout: '', stderr: '' }
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await guestQuadletDown(ep, ['demo'])
    expect(cmds[0]).toMatch(/qctl quadlet down --root.*'demo'/)
  })

  test('guestQuadletPs runs quadlet ps and prints stdout', async () => {
    spyOn(sshMod, 'withSsh').mockImplementation(async (_opts, fn) => {
      await fn(/** @type {never} */ ({}))
    })
    spyOn(sshMod, 'sshExec').mockResolvedValue({
      code: 0,
      stdout: 'NAME  STATUS\ndemo  running\n',
      stderr: '',
    })
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((m) => {
      lines.push(String(m))
    })
    const code = await guestQuadletPs(ep, ['demo'])
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('demo  running')
  })
})
