import * as pathsMod from '../lib/paths.js'
import * as endpointMod from './endpoint.js'
import { runSync } from './run.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../vm/types.js' */

afterEach(() => {
  // @ts-expect-error restore
  pathsMod.tryGetRepoRoot.mockRestore?.()
  // @ts-expect-error restore
  endpointMod.resolveSyncEndpoint.mockRestore?.()
  // @ts-expect-error restore
  endpointMod.logEndpoint.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
})

describe('runSync', () => {
  test('sets exitCode when not in an instance repo', async () => {
    spyOn(pathsMod, 'tryGetRepoRoot').mockReturnValue(null)
    spyOn(console, 'error').mockImplementation(() => {})
    await runSync(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ dryRun: true, env: 'dev', target: 'workstation' })
      ),
    )
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })

  test('dry-run prints plan without SSH', async () => {
    spyOn(pathsMod, 'tryGetRepoRoot').mockReturnValue('/instance')
    spyOn(endpointMod, 'resolveSyncEndpoint').mockResolvedValue({
      host: '127.0.0.1',
      port: 2222,
      username: 'rocky',
      remoteDir: '/tank/rocky',
      label: 'rocky@127.0.0.1:2222',
    })
    spyOn(endpointMod, 'logEndpoint').mockImplementation(() => {})
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.map(String).join(' '))
    })
    await runSync(
      /** @type {VmArgv & { delete?: boolean }} */ (
        /** @type {never} */ ({
          dryRun: true,
          env: 'dev',
          target: 'workstation',
          delete: true,
        })
      ),
    )
    expect(lines.some((l) => l.includes('dry-run done'))).toBe(true)
  })
})
