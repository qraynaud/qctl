import { TARGETS, defaultVmName, resolveVmName } from './target.js'
import { describe, expect, test } from 'bun:test'

/** @import { VmArgv } from '../vm/types.js' */

describe('target helpers', () => {
  test('TARGETS lists driver targets', () => {
    expect([...TARGETS]).toEqual(['local', 'proxmox'])
  })

  test('defaultVmName for local vs proxmox', () => {
    expect(defaultVmName({ target: 'local', env: 'dev' })).toBe('rocky')
    expect(defaultVmName({ target: 'proxmox', env: 'dev' })).toBe('rocky-dev')
    expect(defaultVmName({ target: 'proxmox', env: 'prod' })).toBe('rocky')
    expect(
      defaultVmName({
        target: 'proxmox',
        env: 'eu-prod',
        environments: { 'eu-prod': { production: true } },
      }),
    ).toBe('rocky')
    expect(
      defaultVmName({
        target: 'proxmox',
        env: 'staging',
        environments: { staging: { production: false } },
      }),
    ).toBe('rocky-staging')
    expect(defaultVmName({ target: 'proxmox', env: 'staging', production: true })).toBe('rocky')
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
