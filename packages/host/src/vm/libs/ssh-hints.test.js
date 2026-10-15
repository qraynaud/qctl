import * as util from '../../lib/util.js'
import { printLocalSshInfo } from './ssh-hints.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  util.which.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('ssh-hints', () => {
  test('printLocalSshInfo prints user-net forwards', async () => {
    spyOn(util, 'which').mockResolvedValue(null)
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await printLocalSshInfo({
      connect: 'qemu:///system',
      name: 'rocky',
      network: 'user',
      ports: {
        ssh: { port: 22, forward: 2222 },
        cockpit: { port: 9090, forward: 9090 },
      },
    })
    const joined = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(joined).toMatch(/SSH/)
    expect(joined).toMatch(/2222/)
    expect(joined).toMatch(/Cockpit/)
  })
})
