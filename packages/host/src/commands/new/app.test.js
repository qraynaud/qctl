import * as promptMod from '../../new/prompt.js'
import * as newMod from '../../new.js'
import * as mod from './app.js'
import { describe, expect, spyOn, test } from 'bun:test'

describe('new app command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('app [name]')
    expect(mod.describe).toContain('applications')
  })

  test('handler creates app then scaffolds units', async () => {
    spyOn(promptMod, 'resolveNewAppOptions').mockResolvedValue({
      name: 'web',
      force: false,
      yes: true,
      engine: 'rootless',
      empty: false,
      unit: undefined,
    })
    spyOn(newMod, 'newPackage').mockReturnValue({
      root: '/inst',
      path: '/inst/applications/web',
      extra: ['app.yaml'],
    })
    spyOn(promptMod, 'scaffoldAppUnits').mockResolvedValue(['web/web.container'])
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({ name: 'web', force: false, yes: true })
    expect(newMod.newPackage).toHaveBeenCalledWith('app', 'web', {
      force: false,
      engine: 'rootless',
    })
    expect(promptMod.scaffoldAppUnits).toHaveBeenCalled()
  })

  test('handler sets exitCode on error', async () => {
    spyOn(promptMod, 'resolveNewAppOptions').mockRejectedValue(new Error('cancelled'))
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({})
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
