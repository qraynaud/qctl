import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import yargs from 'yargs'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  DEFAULT_CPU,
  DEFAULT_MEMORY_MIB,
  resolveBootResources,
  sharedDryRun,
  sharedLibvirt,
} from './options.js'
import { resetRepoRootCache } from './paths.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { VmArgv } from '../vm/types.js' */

/** @type {string[]} */
const temps = []
const origInstanceRoot = process.env.QCTL_INSTANCE_ROOT

afterEach(() => {
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

describe('host lib options', () => {
  test('exports default boot resources', () => {
    expect(DEFAULT_CPU).toBe(2)
    expect(DEFAULT_MEMORY_MIB).toBe(4096)
  })

  test('sharedLibvirt / sharedDryRun register flags (no --env/--target)', async () => {
    const help = await sharedDryRun(sharedLibvirt(yargs().scriptName('qctl'))).getHelp()
    expect(help).toMatch(/--profile|\s-p,/)
    expect(help).toMatch(/--name/)
    expect(help).toMatch(/--connect/)
    expect(help).toMatch(/--dry-run/)
    expect(help).not.toMatch(/--env\b/)
    expect(help).not.toMatch(/--target\b/)
  })

  test('resolveBootResources ignores leftover argv memory/vcpus (provision wins)', () => {
    const argv = resolveBootResources(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({
          env: 'dev',
          target: 'workstation',
          memory: 2048,
          vcpus: 4,
        })
      ),
    )
    // No provision → defaults (CLI values discarded).
    expect(argv.memory).toBe(4096)
    expect(argv.vcpus).toBe(2)
  })

  test('resolveBootResources reads doc.data[argv.target]', () => {
    instanceRoot(
      [
        'qctl:',
        '  platform: rocky',
        'workstation:',
        '  memory: 1111',
        '  cpu: 3',
        'proxmox:',
        '  memory: 2222',
        '  cpu: 5',
        '',
      ].join('\n'),
    )
    const ws = resolveBootResources(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({
          env: 'dev',
          target: 'workstation',
          profile: 'default',
        })
      ),
    )
    expect(ws.memory).toBe(1111)
    expect(ws.vcpus).toBe(3)

    const px = resolveBootResources(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({
          env: 'dev',
          target: 'proxmox',
          profile: 'default',
        })
      ),
    )
    expect(px.memory).toBe(2222)
    expect(px.vcpus).toBe(5)
  })
})
