import * as cliMod from '../../secret/cli.js'
import * as syncMod from '../../secret/sync.js'
import * as mod from './sync.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  cliMod.runSecretCommand.mockRestore?.()
  // @ts-expect-error restore
  syncMod.runSecretSync.mockRestore?.()
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

  test('handler delegates to runSecretSync', async () => {
    spyOn(cliMod, 'runSecretCommand').mockImplementation(async (_argv, fn) => {
      await fn('/repo')
    })
    const runSecretSync = spyOn(syncMod, 'runSecretSync').mockResolvedValue({
      synced: 0,
      skipped: 0,
      changed: [],
    })
    await mod.handler({ dryRun: true, restart: true, env: 'dev' })
    expect(runSecretSync).toHaveBeenCalledWith({
      root: expect.stringMatching(/repo$/),
      dryRun: true,
      restart: true,
      qctlEnv: 'dev',
    })
  })

  test('handler sets exitCode on error', async () => {
    spyOn(cliMod, 'runSecretCommand').mockRejectedValue(new Error('sync failed'))
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({})
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
