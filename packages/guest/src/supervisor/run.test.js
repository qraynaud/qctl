import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, writeMinimalInstance } from '@qctl/shared/test-helpers'

import { createContext } from '../quadlet/context.js'
import { createFakeSystem } from '../quadlet/test/fake-system.js'
import { appsSockPath } from './paths.js'
import { runSupervisorDaemon } from './run.js'
import { describe, expect, test } from 'bun:test'

/** @import { OsConfig } from '@qctl/shared' */

/**
 * @param {string} root
 * @returns {OsConfig}
 */
function sampleOs(root) {
  return {
    env: 'dev',
    root,
    repo: { vcs: 'hg' },
    quadletUser: 'apps',
    apps: {
      username: 'apps',
      uid: 900,
      gid: 900,
      subuid: { start: 1, count: 1 },
      subgid: { start: 1, count: 1 },
    },
    admin: { username: 'admin', uid: 1000, gid: 1000 },
    timezone: 'UTC',
    profile: 'appliance',
  }
}

describe('runSupervisorDaemon', () => {
  test('starts sockets then shuts down on AbortSignal', async () => {
    const dir = makeTempDir()
    const root = join(dir, 'instance')
    writeMinimalInstance(root, { withEnvRefs: false, withSchema: false, withOverlay: false })
    const runDir = join(dir, 'run')
    const osPath = join(dir, 'config.json')
    const osConfig = sampleOs(root)
    writeFileSync(osPath, `${JSON.stringify(osConfig, null, 2)}\n`)
    /** @type {string[]} */
    const logs = []
    const ac = new AbortController()

    const ctx = createContext({
      root,
      osConfig,
      sys: createFakeSystem({ dir: join(dir, 'sys') }),
      log: () => {},
    })

    const done = runSupervisorDaemon({
      runDir,
      osConfigPath: osPath,
      ctx,
      log: (l) => logs.push(l),
      signal: ac.signal,
      exitProcess: false,
    })

    for (let i = 0; i < 100; i++) {
      if (logs.some((l) => l.includes('listening'))) break
      await Bun.sleep(10)
    }
    expect(logs.some((l) => l.includes('listening'))).toBe(true)
    expect(existsSync(appsSockPath(runDir))).toBe(true)

    ac.abort()
    await done
    expect(logs.some((l) => l.includes('abort'))).toBe(true)
    expect(existsSync(appsSockPath(runDir))).toBe(false)
  })
})
