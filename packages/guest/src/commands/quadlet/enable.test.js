import * as mod from './enable.js'
import * as rpcMod from './rpc.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  rpcMod.callQuadlet.mockRestore?.()
})

describe('quadlet enable command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('enable <apps..>')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler sends enable op', async () => {
    const call = spyOn(rpcMod, 'callQuadlet').mockImplementation(async () => {})
    await mod.handler({ apps: ['web'], install: true })
    expect(call).toHaveBeenCalledWith({ op: 'enable', apps: ['web'], install: true })
  })
})
