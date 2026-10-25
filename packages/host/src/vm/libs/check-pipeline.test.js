import { runVmCheck } from './check-pipeline.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmContext } from '../driver-contract.js' */

afterEach(() => {
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
})

describe('runVmCheck', () => {
  test('prefers module.targetCheck', async () => {
    let called = false
    const ok = await runVmCheck(
      /** @type {VmContext} */ ({
        name: 'rocky',
        env: 'dev',
        timeout: 1,
        dryRun: false,
      }),
      {
        id: /** @type {never} */ ('workstation'),
        targetCheck: async () => {
          called = true
          return true
        },
      },
    )
    expect(called).toBe(true)
    expect(ok).toBe(true)
  })

  test('falls back to collectCheckFacts', async () => {
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
    const ok = await runVmCheck(
      /** @type {VmContext} */ ({
        name: 'rocky',
        env: 'dev',
        timeout: 1,
        dryRun: false,
      }),
      {
        id: /** @type {never} */ ('workstation'),
        collectCheckFacts: async () => ({
          items: [
            { id: 'libvirt', ok: true, detail: 'ok' },
            { id: 'domain', ok: false, detail: 'absent' },
          ],
        }),
      },
    )
    expect(ok).toBe(false)
    expect(process.exitCode).toBe(1)
  })
})
