import * as promptMod from '../../new/prompt.js'
import * as newMod from '../../new.js'
import * as mod from './unit.js'
import { describe, expect, spyOn, test } from 'bun:test'

describe('new unit command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('unit [app] [name]')
    expect(mod.describe).toContain('unit')
  })

  test('handler creates a unit', async () => {
    spyOn(promptMod, 'resolveNewUnitOptions').mockResolvedValue({
      app: 'demo',
      name: 'web',
      force: false,
      container: 'stub',
      envStub: false,
    })
    spyOn(newMod, 'newUnit').mockReturnValue({
      root: '/inst',
      app: 'demo',
      name: 'web',
      path: '/inst/applications/demo/web',
      extra: ['web/.env.schema', 'web/web.container'],
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({ app: 'demo', name: 'web' })
    expect(newMod.newUnit).toHaveBeenCalledWith('demo', 'web', {
      force: false,
      container: 'stub',
      envStub: false,
    })
  })
})
