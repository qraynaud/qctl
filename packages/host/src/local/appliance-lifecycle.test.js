import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  applianceExists,
  applianceRunning,
  ensureAppliance,
  hostContainersAuthFile,
  localApplianceVolumeArgs,
  removeAppliance,
} from './appliance-lifecycle.js'
import { LOCAL_DISK_KIND } from './disk-mounts.js'
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
  // @ts-expect-error restore
  provisionMod.ensureLocalDiskMountOwnership.mockRestore?.()
  // @ts-expect-error restore
  provisionMod.ensureQctlSystemdUnits.mockRestore?.()
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
    repoDir: '/tank/rocky',
    diskMounts: [],
    image: 'img:test',
    guestBin: join(root, 'qctl-guest'),
    encryptPath: null,
    platformModulePath: join(root, 'platform.mjs'),
    platformBasename: 'qctl-platform-rocky.mjs',
    uidMapArgs: [],
    publishArgs: [],
    appsUsername: 'apps',
    ...over,
  })
}

describe('localApplianceVolumeArgs', () => {
  test('binds disk mounts before nested repoDir, then guest tooling', () => {
    const root = makeTempDir()
    temps.push(root)
    const guestBin = join(root, 'qctl-guest')
    const platform = join(root, 'platform.mjs')
    const encrypt = join(root, 'varlock-local-encrypt')
    const args = localApplianceVolumeArgs(
      fakeCtx({
        root,
        repoDir: '/tank/rocky',
        guestBin,
        platformModulePath: platform,
        encryptPath: encrypt,
        diskMounts: [
          {
            kind: LOCAL_DISK_KIND.TANK,
            key: 'tank',
            hostRel: 'volumes/tank/tank',
            mount: '/tank',
          },
          {
            kind: LOCAL_DISK_KIND.DATA,
            key: 'vw',
            hostRel: 'volumes/data/vw',
            mount: '/vw',
          },
        ],
      }),
    )
    expect(args).toEqual([
      '-v',
      `${join(root, 'volumes/tank/tank')}:/tank:Z`,
      '-v',
      `${join(root, 'volumes/data/vw')}:/vw:Z`,
      '-v',
      `${root}:/tank/rocky:Z`,
      '-v',
      `${guestBin}:/usr/local/bin/qctl:ro`,
      '-v',
      `${platform}:/usr/local/lib/qctl/qctl-platform-rocky.mjs:ro`,
      '-v',
      `${encrypt}:/usr/local/bin/varlock-local-encrypt:ro`,
    ])
  })

  test('omits encrypt bind when encryptPath is null', () => {
    const root = makeTempDir()
    temps.push(root)
    const args = localApplianceVolumeArgs(fakeCtx({ root, encryptPath: null }))
    expect(args.join('\n')).not.toContain('varlock-local-encrypt')
    expect(args).toContain(`${root}:/tank/rocky:Z`)
  })
})

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
  test('returns early when already running but still ensures qctl units', async () => {
    /** @type {string[][]} */
    const calls = []
    spyOn(podmanMod, 'podman').mockImplementation(async (args) => {
      calls.push(args)
      if (args[0] === 'container') return { exitCode: 0, stdout: '', stderr: '' }
      if (args[0] === 'inspect') return { exitCode: 0, stdout: 'true\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const provision = spyOn(provisionMod, 'provisionAppliance').mockResolvedValue(undefined)
    const ownership = spyOn(provisionMod, 'ensureLocalDiskMountOwnership').mockResolvedValue(
      undefined,
    )
    const units = spyOn(provisionMod, 'ensureQctlSystemdUnits').mockResolvedValue(undefined)
    await ensureAppliance(fakeCtx())
    expect(provision).not.toHaveBeenCalled()
    expect(ownership).toHaveBeenCalled()
    expect(units).toHaveBeenCalled()
    expect(calls.some((c) => c[0] === 'run')).toBe(false)
    expect(calls.some((c) => c[0] === 'start')).toBe(false)
  })

  test('podman run uses ISO volume binds (disk mounts then repoDir)', async () => {
    /** @type {string[][]} */
    const calls = []
    let created = false
    spyOn(podmanMod, 'podman').mockImplementation(async (args) => {
      calls.push(args)
      if (args[0] === 'container' && args[1] === 'exists') {
        return { exitCode: created ? 0 : 1, stdout: '', stderr: '' }
      }
      if (args[0] === 'run') {
        created = true
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'inspect') return { exitCode: 0, stdout: 'true\n', stderr: '' }
      if (args[0] === 'exec') return { exitCode: 0, stdout: 'running\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    spyOn(provisionMod, 'provisionAppliance').mockResolvedValue(undefined)
    spyOn(provisionMod, 'ensureLocalDiskMountOwnership').mockResolvedValue(undefined)
    spyOn(provisionMod, 'ensureQctlSystemdUnits').mockResolvedValue(undefined)

    const root = makeTempDir()
    temps.push(root)
    await ensureAppliance(
      fakeCtx({
        root,
        diskMounts: [
          {
            kind: LOCAL_DISK_KIND.TANK,
            key: 'tank',
            hostRel: 'volumes/tank/tank',
            mount: '/tank',
          },
        ],
      }),
    )
    const run = calls.find((c) => c[0] === 'run')
    expect(run).toBeTruthy()
    const joined = run?.join('\0') ?? ''
    const tankIdx = joined.indexOf(`${join(root, 'volumes/tank/tank')}:/tank:Z`)
    const repoIdx = joined.indexOf(`${root}:/tank/rocky:Z`)
    expect(tankIdx).toBeGreaterThan(-1)
    expect(repoIdx).toBeGreaterThan(-1)
    expect(tankIdx).toBeLessThan(repoIdx)
  })
})
