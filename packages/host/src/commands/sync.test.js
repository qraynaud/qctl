import * as runMod from '../sync/run.js'
import * as mod from './sync.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../vm/types.js' */

afterEach(() => {
  // @ts-expect-error restore
  runMod.runSync.mockRestore?.()
})

describe('sync command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('sync')
    expect(mod.describe).toMatch(/waits until the profile VM is reachable/i)
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler delegates to runSync', async () => {
    const runSync = spyOn(runMod, 'runSync').mockResolvedValue(undefined)
    const argv = /** @type {VmArgv & { user?: string, remoteDir?: string }} */ (
      /** @type {never} */ ({ user: 'rocky', remoteDir: '/tank/rocky', dryRun: true })
    )
    await mod.handler(argv)
    expect(runSync).toHaveBeenCalledWith(argv)
  })
})
