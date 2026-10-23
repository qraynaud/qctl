import * as promptMod from '../../new/prompt.js'
import * as newMod from '../../new.js'
import * as mod from './common.js'
import { describe, expect, spyOn, test } from 'bun:test'

describe('new common command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('common [name]')
    expect(mod.describe).toContain('common/')
  })

  test('handler creates a common package', async () => {
    spyOn(promptMod, 'resolveNewNamedPackageOptions').mockResolvedValue({
      name: 'lib',
      force: true,
    })
    spyOn(newMod, 'newPackage').mockReturnValue({
      root: '/inst',
      path: '/inst/common/lib',
      extra: [],
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({ name: 'lib', force: true })
    expect(promptMod.resolveNewNamedPackageOptions).toHaveBeenCalledWith(
      { name: 'lib', force: true, yes: false },
      { kind: 'common' },
    )
    expect(newMod.newPackage).toHaveBeenCalledWith('common', 'lib', { force: true })
  })
})
