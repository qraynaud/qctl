import { runVmDestroy } from './destroy-pipeline.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmContext, VmDriverRegistration } from '../driver-contract.js' */

afterEach(() => {
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

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

describe('runVmDestroy', () => {
  test('dry-run does not destroy', async () => {
    let destroyed = false
    spyOn(console, 'log').mockImplementation(() => {})
    await runVmDestroy(
      ctx({ dryRun: true }),
      { keepDisks: [] },
      /** @type {VmDriverRegistration} */ ({
        id: /** @type {never} */ ('workstation'),
        find: async () => ({ name: 'rocky' }),
        destroy: async () => {
          destroyed = true
        },
      }),
    )
    expect(destroyed).toBe(false)
  })

  test('still calls destroy when guest absent (wipe policy)', async () => {
    let destroyCalls = 0
    /** @type {string[] | undefined} */
    let keep
    spyOn(console, 'log').mockImplementation(() => {})
    await runVmDestroy(
      ctx(),
      { keepDisks: ['rocky-data0'] },
      {
        id: /** @type {never} */ ('workstation'),
        find: async () => null,
        destroy: async (_c, opts) => {
          destroyCalls += 1
          keep = opts?.keepDisks
        },
      },
    )
    expect(destroyCalls).toBe(1)
    expect(keep).toEqual(['rocky-data0'])
  })

  test('clears INSTALLED then destroy when present', async () => {
    const handle = { name: 'rocky' }
    let cleared = false
    let destroyCalls = 0
    spyOn(console, 'log').mockImplementation(() => {})
    await runVmDestroy(
      ctx(),
      { keepDisks: ['rocky-data0'] },
      {
        id: /** @type {never} */ ('workstation'),
        find: async () => handle,
        createFlagStore: async () =>
          /** @type {never} */ ({
            has: async () => true,
            get: async () => true,
            set: async () => {},
            delete: async () => {
              cleared = true
            },
          }),
        destroy: async () => {
          destroyCalls += 1
        },
      },
    )
    expect(cleared).toBe(true)
    expect(destroyCalls).toBe(1)
  })
})
