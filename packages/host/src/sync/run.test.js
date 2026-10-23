import * as pathsMod from '../lib/paths.js'
import * as endpointMod from './endpoint.js'
import * as repoMod from './repo.js'
import { runSync } from './run.js'
import * as sshMod from './ssh.js'
import * as waitMod from './wait-ssh.js'
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
  waitMod.waitForSsh.mockRestore?.()
  // @ts-expect-error restore
  sshMod.withSsh.mockRestore?.()
  // @ts-expect-error restore
  repoMod.syncRepo.mockRestore?.()
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
    const wait = spyOn(waitMod, 'waitForSsh')
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
    expect(wait).not.toHaveBeenCalled()
    expect(lines.some((l) => l.includes('would wait for SSH'))).toBe(true)
    expect(lines.some((l) => l.includes('dry-run done'))).toBe(true)
  })

  test('waits for SSH then syncs repo', async () => {
    spyOn(pathsMod, 'tryGetRepoRoot').mockReturnValue('/instance')
    spyOn(endpointMod, 'resolveSyncEndpoint').mockResolvedValue({
      host: '127.0.0.1',
      port: 2222,
      username: 'rocky',
      remoteDir: '/tank/rocky',
      label: 'rocky@127.0.0.1:2222',
    })
    spyOn(endpointMod, 'logEndpoint').mockImplementation(() => {})
    const wait = spyOn(waitMod, 'waitForSsh').mockResolvedValue(undefined)
    const syncRepo = spyOn(repoMod, 'syncRepo').mockResolvedValue(undefined)
    spyOn(sshMod, 'withSsh').mockImplementation(async (_opts, fn) => {
      await fn(/** @type {never} */ ({}))
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await runSync(
      /** @type {never} */ ({
        dryRun: false,
        env: 'dev',
        target: 'workstation',
        delete: true,
        sshTimeout: 90,
      }),
    )
    expect(wait).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        timeoutSec: 90,
        prefix: 'sync',
      }),
    )
    expect(syncRepo).toHaveBeenCalled()
  })

  test('SSH wait failure surfaces vm up hint and exitCode', async () => {
    spyOn(pathsMod, 'tryGetRepoRoot').mockReturnValue('/instance')
    spyOn(endpointMod, 'resolveSyncEndpoint').mockResolvedValue({
      host: '127.0.0.1',
      port: 2222,
      username: 'rocky',
      remoteDir: '/tank/rocky',
      label: 'rocky@127.0.0.1:2222',
    })
    spyOn(endpointMod, 'logEndpoint').mockImplementation(() => {})
    spyOn(waitMod, 'waitForSsh').mockRejectedValue(
      new Error('SSH not ready within 1s\n  Tip: qctl vm up'),
    )
    /** @type {string[]} */
    const errs = []
    spyOn(console, 'error').mockImplementation((...a) => {
      errs.push(a.map(String).join(' '))
    })
    spyOn(console, 'log').mockImplementation(() => {})
    await runSync(
      /** @type {never} */ ({
        dryRun: false,
        env: 'dev',
        target: 'workstation',
      }),
    )
    expect(process.exitCode).toBe(1)
    expect(errs.join('\n')).toMatch(/vm up/)
    process.exitCode = 0
  })
})
