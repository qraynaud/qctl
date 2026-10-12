import yargs from 'yargs'

import {
  DEFAULT_CPU,
  DEFAULT_MEMORY_MIB,
  resolveBootResources,
  sharedDryRun,
  sharedTarget,
} from './options.js'
import { describe, expect, test } from 'bun:test'

/** @import { VmArgv } from '../vm/types.js' */

describe('host lib options', () => {
  test('exports default boot resources', () => {
    expect(DEFAULT_CPU).toBe(2)
    expect(DEFAULT_MEMORY_MIB).toBe(4096)
  })

  test('sharedTarget / sharedDryRun register flags', async () => {
    const help = await sharedDryRun(sharedTarget(yargs().scriptName('qctl'))).getHelp()
    expect(help).toMatch(/--target/)
    expect(help).toMatch(/--env/)
    expect(help).toMatch(/--dry-run/)
  })

  test('resolveBootResources keeps explicit memory and vcpus', () => {
    const argv = resolveBootResources(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({
          env: 'dev',
          target: 'local',
          memory: 2048,
          vcpus: 4,
        })
      ),
    )
    expect(argv.memory).toBe(2048)
    expect(argv.vcpus).toBe(4)
  })
})
