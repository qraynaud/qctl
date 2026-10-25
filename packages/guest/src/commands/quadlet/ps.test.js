import * as mod from './ps.js'
import * as rpcMod from './rpc.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  rpcMod.callQuadlet.mockRestore?.()
})

describe('quadlet ps command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('ps [apps..]')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler sends ps op with apps', async () => {
    const call = spyOn(rpcMod, 'callQuadlet').mockImplementation(async () => {})
    await mod.handler({ apps: ['web'] })
    expect(call).toHaveBeenCalledWith({ op: 'ps', apps: ['web'] })
  })

  test('handler omits apps when none given', async () => {
    const call = spyOn(rpcMod, 'callQuadlet').mockImplementation(async () => {})
    await mod.handler({})
    expect(call).toHaveBeenCalledWith({ op: 'ps' })
  })
})
