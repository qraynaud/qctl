import * as contextMod from '../quadlet/context.js'
import * as systemMod from '../quadlet/system.js'
import { runSecretCommand } from './cli.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  contextMod.resolveInstanceRoot.mockRestore?.()
  // @ts-expect-error restore
  systemMod.createSystem.mockRestore?.()
  // @ts-expect-error restore
  systemMod.tryEnsureRoot.mockRestore?.()
})

describe('runSecretCommand', () => {
  test('resolves instance root, prefers root, then invokes fn', async () => {
    spyOn(contextMod, 'resolveInstanceRoot').mockReturnValue('/instance')
    const sys = { uid: () => 0 }
    spyOn(systemMod, 'createSystem').mockReturnValue(
      /** @type {ReturnType<typeof systemMod.createSystem>} */ (sys),
    )
    const tryEnsureRoot = spyOn(systemMod, 'tryEnsureRoot').mockImplementation(() => true)
    /** @type {string[]} */
    const seen = []
    await runSecretCommand({ root: '/ignored-by-mock' }, async (root) => {
      seen.push(root)
    })
    expect(contextMod.resolveInstanceRoot).toHaveBeenCalled()
    expect(tryEnsureRoot).toHaveBeenCalled()
    expect(seen).toEqual(['/instance'])
  })
})
