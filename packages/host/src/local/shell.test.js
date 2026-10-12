import * as lifeMod from './appliance-lifecycle.js'
import * as contextMod from './context.js'
import * as execMod from './exec-in.js'
import * as mod from './shell.js'
import * as utilMod from './util.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  contextMod.createLocalContext.mockRestore?.()
  // @ts-expect-error restore
  lifeMod.applianceRunning.mockRestore?.()
  // @ts-expect-error restore
  lifeMod.ensureAppliance.mockRestore?.()
  // @ts-expect-error restore
  execMod.shellInAppliance.mockRestore?.()
  // @ts-expect-error restore
  utilMod.die.mockRestore?.()
  process.exitCode = 0
})

describe('local shell command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('shell')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler dies when --no-ensure and appliance is not running', async () => {
    spyOn(contextMod, 'createLocalContext').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof contextMod.createLocalContext>>} */ ({
        name: 'qctl-local-x',
      }),
    )
    spyOn(lifeMod, 'applianceRunning').mockResolvedValue(false)
    spyOn(utilMod, 'die').mockImplementation(
      /** @returns {never} */ (msg) => {
        throw new Error(String(msg))
      },
    )
    await expect(mod.handler({ env: 'dev', noEnsure: true })).rejects.toThrow(/not running/)
  })

  test('handler opens a shell after ensureAppliance', async () => {
    spyOn(contextMod, 'createLocalContext').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof contextMod.createLocalContext>>} */ ({
        name: 'qctl-local-x',
      }),
    )
    spyOn(lifeMod, 'ensureAppliance').mockResolvedValue(undefined)
    spyOn(execMod, 'shellInAppliance').mockResolvedValue(0)
    await mod.handler({ env: 'dev' })
    expect(execMod.shellInAppliance).toHaveBeenCalled()
  })
})
