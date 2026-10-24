import { createTestContext } from '../context.test-helpers.js'
import { StageError } from '../errors.js'
import poweroff from './poweroff.js'
import { describe, expect, spyOn, test } from 'bun:test'

describe('poweroff stage', () => {
  test('plan lists sync + poweroff', () => {
    expect(poweroff.plan(createTestContext({ log: () => {} }))).toEqual([
      'sync; systemctl poweroff --no-block',
    ])
  })

  test('run syncs then systemctl poweroff', async () => {
    spyOn(Bun, 'sleep').mockResolvedValue(undefined)
    /** @type {string[][]} */
    const calls = []
    const ctx = createTestContext({
      log: () => {},
      exec: async (argv) => {
        calls.push(argv)
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    await poweroff.run(ctx)
    expect(calls[0]).toEqual(['sync'])
    expect(calls[1]).toEqual(['systemctl', 'poweroff', '--no-block'])
    // @ts-expect-error restore
    Bun.sleep.mockRestore?.()
  })

  test('run falls back to poweroff and throws if both fail', async () => {
    spyOn(Bun, 'sleep').mockResolvedValue(undefined)
    const ctx = createTestContext({
      log: () => {},
      exec: async (argv) => {
        if (argv[0] === 'sync') return { code: 0, stdout: '', stderr: '' }
        return { code: 1, stdout: '', stderr: 'no' }
      },
    })
    await expect(poweroff.run(ctx)).rejects.toBeInstanceOf(StageError)
    // @ts-expect-error restore
    Bun.sleep.mockRestore?.()
  })
})
