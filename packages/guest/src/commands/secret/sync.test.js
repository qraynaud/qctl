import * as rpcMod from './rpc.js'
import * as mod from './sync.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  rpcMod.callSecret.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
})

describe('secret sync command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('sync')
    expect(mod.describe).toContain('@sensitive')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler builds sync params and calls callSecret', async () => {
    const callSecret = spyOn(rpcMod, 'callSecret').mockResolvedValue(undefined)
    await mod.handler({ dryRun: true, restart: true, env: 'dev', app: 'caddy' })
    expect(callSecret).toHaveBeenCalledWith({
      op: 'sync',
      dryRun: true,
      restart: true,
      env: 'dev',
      app: 'caddy',
    })
  })

  test('handler sets exitCode on error', async () => {
    spyOn(rpcMod, 'callSecret').mockRejectedValue(new Error('sync failed'))
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({})
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
