import * as newMod from '../../new.js'
import * as mod from './app.js'
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

describe('new app command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('app <name>')
    expect(mod.describe).toContain('applications')
  })

  test('handler creates an app package', async () => {
    spyOn(newMod, 'newPackage').mockReturnValue({
      root: '/inst',
      path: '/inst/applications/web',
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({ name: 'web', force: false })
    expect(newMod.newPackage).toHaveBeenCalledWith('app', 'web', { force: false })
  })

  test('handler sets exitCode on error', async () => {
    spyOn(newMod, 'newPackage').mockImplementation(() => {
      throw new Error('exists')
    })
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({ name: 'web' })
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
