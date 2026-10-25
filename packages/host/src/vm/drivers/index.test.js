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

describe('resolveDriver', () => {
  test('resolveDriver returns module + ctx for workstation', async () => {
    instanceRoot('qctl:\n  platform: rocky\n')
    const argv = /** @type {VmArgv} */ (
      /** @type {never} */ ({
        memory: 4096,
        vcpus: 2,
      })
    )
    const { module: drv, ctx, specs } = await mod.resolveDriver(argv)
    expect(String(drv.id)).toBe('workstation')
    expect(ctx.name).toBe('rocky')
    expect(ctx.env).toBe('dev')
    expect(specs.memory).toBe(4096)
    expect(specs.vcpus).toBe(2)
    expect(argv.target).toBe('workstation')
    expect(argv.name).toBe('rocky')
    expect(typeof drv.getStatus).toBe('function')
  })

  test('resolveDriver loads proxmox module and name', async () => {
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
    const { module: drv, ctx } = await mod.resolveDriver(argv)
    expect(String(drv.id)).toBe('proxmox')
    expect(ctx.name).toBe('rocky-dev')
    expect(argv.target).toBe('proxmox')
    expect(argv.env).toBe('dev')
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
    await expect(mod.resolveDriver(argv)).rejects.toThrow(/exit/)
  })
})
