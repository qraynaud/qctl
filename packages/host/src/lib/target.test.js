import { ENVS, TARGETS, defaultVmName, resolveVmName } from './target.js'
import { describe, expect, test } from 'bun:test'

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
})
