import { toVmContext, toVmSpecs } from './context.js'
import { describe, expect, test } from 'bun:test'

/** @import { VmArgv } from './types.js' */

/** @param {Partial<VmArgv>} patch */
function argv(patch) {
  return /** @type {VmArgv} */ (/** @type {never} */ ({ ...patch }))
}

describe('toVmContext', () => {
  test('maps identity / session fields only', () => {
    const ctx = toVmContext(
      argv({
        env: 'staging',
        profile: 'rocky',
        production: true,
        name: 'rocky-staging',
        dryRun: true,
        memory: 8192,
        vcpus: 4,
        timeout: 30,
        connect: 'qemu:///system',
      }),
    )
    expect(ctx).toEqual({
      env: 'staging',
      profile: 'rocky',
      production: true,
      name: 'rocky-staging',
      dryRun: true,
      timeout: 30,
      signal: undefined,
      connect: 'qemu:///system',
    })
  })

  test('defaults env/dryRun/timeout when omitted', () => {
    const ctx = toVmContext(argv({ name: 'rocky-dev' }))
    expect(ctx.env).toBe('dev')
    expect(ctx.dryRun).toBe(false)
    expect(ctx.timeout).toBe(0)
  })

  test('rejects missing name', () => {
    expect(() => toVmContext(argv({}))).toThrow(/name/)
  })
})

describe('toVmSpecs', () => {
  test('maps soft guest fields from argv (memory/vcpus only)', () => {
    expect(
      toVmSpecs(
        argv({
          memory: 8192,
          vcpus: 4,
        }),
      ),
    ).toEqual({
      memory: 8192,
      vcpus: 4,
    })
  })

  test('rejects missing boot resources', () => {
    expect(() => toVmSpecs(argv({ name: 'x' }))).toThrow(/memory/)
  })
})
