import yargs from 'yargs'

import {
  DEFAULT_CPU,
  DEFAULT_MEMORY_MIB,
  resolveBootResources,
  sharedDryRun,
  sharedLibvirt,
} from './options.js'
import { describe, expect, test } from 'bun:test'

/** @import { VmArgv } from '../vm/types.js' */

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

  test('resolveBootResources keeps explicit memory and vcpus', () => {
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
    expect(argv.memory).toBe(2048)
    expect(argv.vcpus).toBe(4)
  })
})
