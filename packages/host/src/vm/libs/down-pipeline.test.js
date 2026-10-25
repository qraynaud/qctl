import { runVmDown } from './down-pipeline.js'
import { describe, expect, spyOn, test } from 'bun:test'

/** @import { VmContext, VmDriverRegistration } from '../driver-contract.js' */

/** @returns {VmContext} */
function ctx(patch = {}) {
  return {
    name: 'rocky',
    env: 'dev',
    timeout: 120,
    dryRun: false,
    ...patch,
  }
}

describe('runVmDown', () => {
  test('dry-run does not call stop', async () => {
    let stopped = false
    await runVmDown(
      ctx({ dryRun: true }),
      { timeout: 30 },
      /** @type {VmDriverRegistration} */ ({
        id: /** @type {never} */ ('workstation'),
        find: async () => ({ name: 'rocky' }),
        stop: async () => {
          stopped = true
        },
        powerState: async () => ({ kind: 'running' }),
      }),
    )
    expect(stopped).toBe(false)
  })

  test('already stopped calls stop once then returns', async () => {
    /** @type {unknown[]} */
    const stops = []
    await runVmDown(
      ctx(),
      {},
      {
        id: /** @type {never} */ ('workstation'),
        find: async () => ({ name: 'rocky' }),
        stop: async (_c, _v, opts) => {
          stops.push(opts)
        },
        powerState: async () => ({ kind: 'stopped', detail: 'shut off' }),
      },
    )
    expect(stops).toEqual([{ force: false }])
  })

  test('force poweroff after timeout', async () => {
    let n = 0
    /** @type {unknown[]} */
    const stops = []
    spyOn(console, 'log').mockImplementation(() => {})
    await runVmDown(
      ctx({ timeout: 0 }),
      { force: true, timeout: 0 },
      {
        id: /** @type {never} */ ('workstation'),
        find: async () => ({ name: 'rocky' }),
        stop: async (_c, _v, opts) => {
          stops.push(opts)
        },
        powerState: async () => {
          n += 1
          // first: running (before stop); then still running until force
          return { kind: 'running' }
        },
      },
    )
    expect(stops.some((o) => o && /** @type {{ force?: boolean }} */ (o).force === true)).toBe(true)
    expect(n).toBeGreaterThan(0)
    // @ts-expect-error restore
    console.log.mockRestore?.()
  })
})
