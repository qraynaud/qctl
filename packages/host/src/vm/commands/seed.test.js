import * as runMod from '../libs/seed/run.js'
import * as mod from './seed.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  runMod.runSeed.mockRestore?.()
})

describe('vm seed command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('seed')
    expect(mod.describe).toContain('NoCloud')
  })

  test('handler delegates to runSeed', async () => {
    const runSeed = spyOn(runMod, 'runSeed').mockResolvedValue({
      isoPath: '/tmp/seed.iso',
      imgPath: '/tmp/seed.img',
      profile: 'appliance',
      env: 'dev',
      instanceId: 'id',
      keepDir: null,
    })
    const argv = /** @type {VmArgv} */ (
      /** @type {never} */ ({ env: 'dev', target: 'local', profile: 'appliance' })
    )
    await mod.handler(argv)
    expect(runSeed).toHaveBeenCalledWith(argv)
  })
})
