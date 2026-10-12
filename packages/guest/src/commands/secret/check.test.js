import * as checkMod from '../../secret/check.js'
import * as cliMod from '../../secret/cli.js'
import * as mod from './check.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  cliMod.runSecretCommand.mockRestore?.()
  // @ts-expect-error restore
  checkMod.runSecretCheck.mockRestore?.()
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

  test('handler sets exitCode 1 when report is not ok', async () => {
    spyOn(cliMod, 'runSecretCommand').mockImplementation(async (_argv, fn) => {
      await fn('/instance')
    })
    spyOn(checkMod, 'runSecretCheck').mockResolvedValue({
      ok: false,
      rows: [],
      qctlEnv: 'prod',
    })
    await mod.handler({ env: 'prod' })
    expect(checkMod.runSecretCheck).toHaveBeenCalledWith({
      root: expect.stringMatching(/instance$/),
      qctlEnv: 'prod',
    })
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })

  test('handler logs and sets exitCode on error', async () => {
    spyOn(cliMod, 'runSecretCommand').mockRejectedValue(new Error('boom'))
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({})
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
