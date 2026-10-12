import * as lifeMod from './appliance-lifecycle.js'
import * as contextMod from './context.js'
import * as mod from './down.js'
import * as utilMod from './util.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  contextMod.createLocalContext.mockRestore?.()
  // @ts-expect-error restore
  lifeMod.applianceExists.mockRestore?.()
  // @ts-expect-error restore
  utilMod.log.mockRestore?.()
})

describe('local down command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('down [apps..]')
    expect(mod.describe).toContain('Stop apps')
    expect(typeof mod.builder).toBe('function')
  })

  test('handler no-ops when appliance is missing', async () => {
    spyOn(contextMod, 'createLocalContext').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof contextMod.createLocalContext>>} */ ({
        name: 'qctl-local-x',
        root: '/tmp/x',
      }),
    )
    spyOn(lifeMod, 'applianceExists').mockResolvedValue(false)
    /** @type {string[]} */
    const lines = []
    spyOn(utilMod, 'log').mockImplementation((m) => {
      lines.push(String(m))
    })
    await mod.handler({ env: 'dev' })
    expect(lines.some((l) => l.includes('no appliance'))).toBe(true)
  })
})
