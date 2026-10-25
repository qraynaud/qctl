import * as mod from './check.js'
import * as rpcMod from './rpc.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  rpcMod.callSecret.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
})

describe('secret check command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('check')
    expect(mod.describe).toContain('drift')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler builds check params and calls callSecret', async () => {
    const callSecret = spyOn(rpcMod, 'callSecret').mockImplementation(async () => {
      process.exitCode = 1
    })
    await mod.handler({ env: 'prod', app: 'web' })
    expect(callSecret).toHaveBeenCalledWith({ op: 'check', env: 'prod', app: 'web' })
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })

  test('handler logs and sets exitCode on error', async () => {
    spyOn(rpcMod, 'callSecret').mockRejectedValue(new Error('boom'))
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({})
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
