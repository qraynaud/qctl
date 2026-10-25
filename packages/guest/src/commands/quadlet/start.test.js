import * as rpcMod from './rpc.js'
import * as mod from './start.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  rpcMod.callQuadlet.mockRestore?.()
})

describe('quadlet start command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('start <apps..>')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler sends start op', async () => {
    const call = spyOn(rpcMod, 'callQuadlet').mockImplementation(async () => {})
    await mod.handler({ apps: ['web'] })
    expect(call).toHaveBeenCalledWith({ op: 'start', apps: ['web'] })
  })
})
