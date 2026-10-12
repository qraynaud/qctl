import { ENVS, TARGETS, assertProxmoxDiskPlan, defaultVmName, resolveVmName } from './target.js'
import { describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../vm/types.js' */

describe('target helpers', () => {
  test('TARGETS and ENVS are fixed', () => {
    expect([...TARGETS]).toEqual(['local', 'proxmox'])
    expect([...ENVS]).toEqual(['dev', 'prod'])
  })

  test('defaultVmName for local vs proxmox', () => {
    expect(defaultVmName({ target: 'local', env: 'dev' })).toBe('rocky')
    expect(defaultVmName({ target: 'proxmox', env: 'dev' })).toBe('rocky-dev')
    expect(defaultVmName({ target: 'proxmox', env: 'prod' })).toBe('rocky')
  })

  test('resolveVmName prefers explicit --name', () => {
    expect(
      resolveVmName(
        /** @type {VmArgv} */ (
          /** @type {never} */ ({ name: ' custom ', target: 'local', env: 'dev' })
        ),
      ),
    ).toBe('custom')
    expect(
      resolveVmName(
        /** @type {VmArgv} */ (/** @type {never} */ ({ target: 'proxmox', env: 'dev' })),
      ),
    ).toBe('rocky-dev')
  })

  test('assertProxmoxDiskPlan blocks proxmox prod', () => {
    expect(() => assertProxmoxDiskPlan({ target: 'local', env: 'prod' })).not.toThrow()
    expect(() => assertProxmoxDiskPlan({ target: 'proxmox', env: 'dev' })).not.toThrow()
    const exit = spyOn(process, 'exit').mockImplementation(
      /** @returns {never} */ () => {
        throw new Error('exit')
      },
    )
    spyOn(console, 'error').mockImplementation(() => {})
    expect(() => assertProxmoxDiskPlan({ target: 'proxmox', env: 'prod' })).toThrow(/exit/)
    expect(exit).toHaveBeenCalledWith(1)
    exit.mockRestore()
    // @ts-expect-error restore
    console.error.mockRestore?.()
  })
})
