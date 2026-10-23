import * as pipeline from '../../libs/up-pipeline.js'
import { up } from './up.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  pipeline.runVmUp.mockRestore?.()
})

describe('workstation up', () => {
  test('delegates to runVmUp with a backend', async () => {
    const run = spyOn(pipeline, 'runVmUp').mockResolvedValue(undefined)
    const argv = /** @type {VmArgv} */ ({
      name: 'rocky',
      connect: 'qemu:///system',
      dryRun: true,
    })
    await up(argv)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]).toBe(argv)
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      dryRun: expect.any(Function),
      findRunnableExisting: expect.any(Function),
      createFirstBoot: expect.any(Function),
    })
  })
})
