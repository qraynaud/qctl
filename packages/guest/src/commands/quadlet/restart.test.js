import * as mod from './restart.js'
import * as rpcMod from './rpc.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  rpcMod.callQuadlet.mockRestore?.()
})

describe('quadlet restart command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('restart <apps..>')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler sends restart op', async () => {
    const call = spyOn(rpcMod, 'callQuadlet').mockImplementation(async () => {})
    await mod.handler({ apps: ['web'] })
    expect(call).toHaveBeenCalledWith({ op: 'restart', apps: ['web'] })
  })
})
