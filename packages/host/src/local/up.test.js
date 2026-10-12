import * as lifeMod from './appliance-lifecycle.js'
import * as quadletMod from './appliance-quadlet.js'
import * as appsMod from './apps.js'
import * as contextMod from './context.js'
import * as mod from './up.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  contextMod.createLocalContext.mockRestore?.()
  // @ts-expect-error restore
  lifeMod.ensureAppliance.mockRestore?.()
  // @ts-expect-error restore
  quadletMod.quadletUp.mockRestore?.()
  // @ts-expect-error restore
  quadletMod.quadletUpAll.mockRestore?.()
  // @ts-expect-error restore
  appsMod.listInstanceApps.mockRestore?.()
})

describe('local up command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('up [apps..]')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler ensures appliance only when no apps given', async () => {
    spyOn(contextMod, 'createLocalContext').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof contextMod.createLocalContext>>} */ ({
        name: 'qctl-local-x',
        root: '/tmp/x',
      }),
    )
    const ensure = spyOn(lifeMod, 'ensureAppliance').mockResolvedValue(undefined)
    await mod.handler({ env: 'dev' })
    expect(ensure).toHaveBeenCalled()
  })
})
