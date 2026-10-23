import * as promptMod from '../../new/prompt.js'
import * as provisionMod from '../../new/provision.js'
import * as mod from './env.js'
import { describe, expect, spyOn, test } from 'bun:test'

describe('new env command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('env [name]')
    expect(mod.describe).toContain('environment')
  })

  test('handler creates an environment', async () => {
    spyOn(promptMod, 'resolveNewEnvOptions').mockResolvedValue({
      name: 'staging',
      force: false,
      production: false,
      from: undefined,
      syncEnvFromYaml: false,
    })
    spyOn(provisionMod, 'newEnv').mockReturnValue({
      root: '/inst',
      name: 'staging',
      written: ['provision/env-staging.yaml'],
      skipped: [],
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({ name: 'staging', yes: true })
    expect(provisionMod.newEnv).toHaveBeenCalledWith('staging', {
      force: false,
      production: false,
      from: undefined,
    })
  })
})
