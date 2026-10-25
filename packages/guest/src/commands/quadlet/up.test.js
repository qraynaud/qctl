import * as rpcMod from './rpc.js'
import * as mod from './up.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  rpcMod.callQuadlet.mockRestore?.()
})

describe('quadlet up command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('up [apps..]')
    expect(mod.describe).toContain('Reconcile')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler sends up op with dry-run and apps', async () => {
    const call = spyOn(rpcMod, 'callQuadlet').mockImplementation(async () => {})
    await mod.handler({ apps: ['web'], dryRun: true })
    expect(call).toHaveBeenCalledWith({ op: 'up', dryRun: true, apps: ['web'] })
  })

  test('handler omits apps when none given', async () => {
    const call = spyOn(rpcMod, 'callQuadlet').mockImplementation(async () => {})
    await mod.handler({ dryRun: false })
    expect(call).toHaveBeenCalledWith({ op: 'up', dryRun: false })
  })
})
