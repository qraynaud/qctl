import * as rpcMod from './rpc.js'
import * as mod from './stop.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  rpcMod.callQuadlet.mockRestore?.()
})

describe('quadlet stop command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('stop <apps..>')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler sends stop op', async () => {
    const call = spyOn(rpcMod, 'callQuadlet').mockImplementation(async () => {})
    await mod.handler({ apps: ['web'] })
    expect(call).toHaveBeenCalledWith({ op: 'stop', apps: ['web'] })
  })
})
