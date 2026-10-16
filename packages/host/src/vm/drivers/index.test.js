import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { resetRepoRootCache } from '../../lib/paths.js'
import * as mod from './index.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

/** @type {string[]} */
const temps = []
const origInstanceRoot = process.env.QCTL_INSTANCE_ROOT

afterEach(() => {
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  if (origInstanceRoot === undefined) delete process.env.QCTL_INSTANCE_ROOT
  else process.env.QCTL_INSTANCE_ROOT = origInstanceRoot
  resetRepoRootCache()
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

/**
 * @param {string} commonYaml
 * @returns {string}
 */
function instanceRoot(commonYaml) {
  const root = makeTempDir()
  temps.push(root)
  mkdirSync(join(root, 'provision'), { recursive: true })
  writeFileSync(join(root, 'provision', 'common.yaml'), commonYaml, 'utf8')
  process.env.QCTL_INSTANCE_ROOT = root
  resetRepoRootCache()
  return root
}

describe('loadDriver', () => {
  test('loads local driver and resolves name', async () => {
    instanceRoot('qctl:\n  platform: rocky\n')
    const argv = /** @type {VmArgv} */ (
      /** @type {never} */ ({
        memory: '4G',
        vcpus: 2,
      })
    )
    const driver = await mod.loadDriver(argv)
    expect(driver.id).toBe('local')
    expect(argv.target).toBe('local')
    expect(argv.env).toBe('dev')
    expect(argv.name).toBe('rocky')
    expect(typeof driver.up).toBe('function')
    expect(typeof driver.check).toBe('function')
  })

  test('loads proxmox driver', async () => {
    instanceRoot(
      [
        'qctl:',
        '  platform: rocky',
        '  environments:',
        '    dev: {}',
        '  profiles:',
        '    px: { env: dev, target: proxmox }',
        '  default-profile: px',
        '',
      ].join('\n'),
    )
    const argv = /** @type {VmArgv} */ (
      /** @type {never} */ ({
        memory: '4G',
        vcpus: 2,
      })
    )
    const driver = await mod.loadDriver(argv)
    expect(driver.id).toBe('proxmox')
    expect(argv.target).toBe('proxmox')
    expect(argv.env).toBe('dev')
    expect(argv.name).toBe('rocky-dev')
  })

  test('dies on unknown target after profile resolve', async () => {
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
        _qctlProfileResolved: true,
      })
    )
    await expect(mod.loadDriver(argv)).rejects.toThrow(/exit/)
  })
})
