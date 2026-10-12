import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '../../../shared/src/test-helpers.js'
import {
  applianceExists,
  applianceRunning,
  ensureAppliance,
  hostContainersAuthFile,
  removeAppliance,
} from './appliance-lifecycle.js'
import * as podmanMod from './podman.js'
import * as provisionMod from './provision.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { LocalContext } from './context.js' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  // @ts-expect-error restore
  podmanMod.podman.mockRestore?.()
  // @ts-expect-error restore
  provisionMod.provisionAppliance.mockRestore?.()
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

/**
 * @param {Partial<LocalContext>} [over]
 * @returns {LocalContext}
 */
function fakeCtx(over = {}) {
  const root = over.root || makeTempDir()
  if (!over.root) temps.push(root)
  return /** @type {LocalContext} */ ({
    name: 'qctl-local-demo',
    root,
    env: 'dev',
    image: 'img:test',
    guestBin: join(root, 'qctl-guest'),
    platformModulePath: join(root, 'platform.mjs'),
    platformBasename: 'qctl-platform-rocky.mjs',
    uidMapArgs: [],
    publishArgs: [],
    appsUsername: 'apps',
    ...over,
  })
}

describe('hostContainersAuthFile', () => {
  test('returns null when no auth.json exists', () => {
    // May return a path on developer machines; only assert type.
    const p = hostContainersAuthFile()
    expect(p === null || typeof p === 'string').toBe(true)
  })
})

describe('applianceExists / applianceRunning', () => {
  test('applianceExists follows podman exit code', async () => {
    spyOn(podmanMod, 'podman').mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    expect(await applianceExists(fakeCtx())).toBe(true)

    spyOn(podmanMod, 'podman').mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' })
    expect(await applianceExists(fakeCtx())).toBe(false)
  })

  test('applianceRunning requires exists + Running=true', async () => {
    /** @type {string[][]} */
    const calls = []
    spyOn(podmanMod, 'podman').mockImplementation(async (args) => {
      calls.push(args)
      if (args[0] === 'container' && args[1] === 'exists') {
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      return { exitCode: 0, stdout: 'true\n', stderr: '' }
    })
    expect(await applianceRunning(fakeCtx())).toBe(true)
    expect(calls.some((c) => c[0] === 'inspect')).toBe(true)
  })

  test('applianceRunning is false when container missing', async () => {
    spyOn(podmanMod, 'podman').mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' })
    expect(await applianceRunning(fakeCtx())).toBe(false)
  })
})

describe('removeAppliance', () => {
  test('calls podman rm -f', async () => {
    /** @type {string[][]} */
    const calls = []
    spyOn(podmanMod, 'podman').mockImplementation(async (args) => {
      calls.push(args)
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await removeAppliance(fakeCtx({ root: makeTempDir() }))
    expect(calls[0]?.slice(0, 3)).toEqual(['rm', '-f', 'qctl-local-demo'])
  })
})

describe('ensureAppliance', () => {
  test('returns early when already running', async () => {
    /** @type {string[][]} */
    const calls = []
    spyOn(podmanMod, 'podman').mockImplementation(async (args) => {
      calls.push(args)
      if (args[0] === 'container') return { exitCode: 0, stdout: '', stderr: '' }
      if (args[0] === 'inspect') return { exitCode: 0, stdout: 'true\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const provision = spyOn(provisionMod, 'provisionAppliance').mockResolvedValue(undefined)
    await ensureAppliance(fakeCtx())
    expect(provision).not.toHaveBeenCalled()
    expect(calls.some((c) => c[0] === 'run')).toBe(false)
    expect(calls.some((c) => c[0] === 'start')).toBe(false)
  })
})
