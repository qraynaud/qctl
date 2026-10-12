import * as mod from './index.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
})

describe('loadDriver', () => {
  test('loads local driver and resolves name', async () => {
    const argv = /** @type {VmArgv} */ (
      /** @type {never} */ ({
        target: 'local',
        env: 'dev',
        memory: '4G',
        vcpus: 2,
      })
    )
    const driver = await mod.loadDriver(argv)
    expect(driver.id).toBe('local')
    expect(argv.name).toBe('rocky')
    expect(typeof driver.up).toBe('function')
    expect(typeof driver.check).toBe('function')
  })

  test('loads proxmox driver', async () => {
    const argv = /** @type {VmArgv} */ (
      /** @type {never} */ ({
        target: 'proxmox',
        env: 'dev',
        memory: '4G',
        vcpus: 2,
      })
    )
    const driver = await mod.loadDriver(argv)
    expect(driver.id).toBe('proxmox')
    expect(argv.name).toBe('rocky-dev')
  })

  test('dies on unknown target', async () => {
    spyOn(process, 'exit').mockImplementation(
      /** @returns {never} */ () => {
        throw new Error('exit')
      },
    )
    spyOn(console, 'error').mockImplementation(() => {})
    const argv = /** @type {VmArgv} */ (
      /** @type {never} */ ({
        target: 'other',
        env: 'dev',
        memory: '4G',
        vcpus: 2,
      })
    )
    await expect(mod.loadDriver(argv)).rejects.toThrow(/exit/)
  })
})
