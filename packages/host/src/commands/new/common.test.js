import * as newMod from '../../new.js'
import * as mod from './common.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  newMod.newPackage.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
})

describe('new common command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('common <name>')
    expect(mod.describe).toContain('common/')
  })

  test('handler creates a common package', async () => {
    spyOn(newMod, 'newPackage').mockReturnValue({ root: '/inst', path: '/inst/common/lib' })
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({ name: 'lib', force: true })
    expect(newMod.newPackage).toHaveBeenCalledWith('common', 'lib', { force: true })
  })
})
