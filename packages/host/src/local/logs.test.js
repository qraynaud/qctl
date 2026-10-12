import * as lifeMod from './appliance-lifecycle.js'
import * as contextMod from './context.js'
import * as mod from './logs.js'
import * as utilMod from './util.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  contextMod.createLocalContext.mockRestore?.()
  // @ts-expect-error restore
  lifeMod.applianceRunning.mockRestore?.()
  // @ts-expect-error restore
  utilMod.die.mockRestore?.()
})

describe('local logs command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('logs [apps..]')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler dies when appliance is not running', async () => {
    spyOn(contextMod, 'createLocalContext').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof contextMod.createLocalContext>>} */ ({
        name: 'qctl-local-x',
      }),
    )
    spyOn(lifeMod, 'applianceRunning').mockResolvedValue(false)
    const die = spyOn(utilMod, 'die').mockImplementation(
      /** @returns {never} */ (msg) => {
        throw new Error(String(msg))
      },
    )
    await expect(mod.handler({ env: 'dev' })).rejects.toThrow(/not running/)
    expect(die).toHaveBeenCalled()
  })
})
