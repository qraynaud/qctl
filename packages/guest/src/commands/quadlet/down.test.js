import * as mod from './down.js'
import * as rpcMod from './rpc.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  rpcMod.callQuadlet.mockRestore?.()
})

describe('quadlet down command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('down <apps..>')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler sends down op with apps', async () => {
    const call = spyOn(rpcMod, 'callQuadlet').mockImplementation(async () => {})
    await mod.handler({ apps: ['web', 'db'] })
    expect(call).toHaveBeenCalledWith({ op: 'down', apps: ['web', 'db'] })
  })
})
