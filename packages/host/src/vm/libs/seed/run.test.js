import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ISOReader } from '@gcu/iso9660'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from '../../../init.js'
import { getSeed, resetRepoRootCache } from '../../../lib/paths.js'
import { resolveSeedPaths } from './iso.js'
import { runSeed } from './run.js'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const origCwd = process.cwd()
const origDist = process.env.QCTL_GUEST_DIST
const origCache = process.env.QCTL_CACHE_HOME
const origData = process.env.QCTL_DATA_HOME
const origSeed = process.env.QCTL_ROCKY_SEED
const origHome = process.env.HOME
/** @type {string[]} */
const temps = []

beforeEach(() => {
  const base = makeTempDir()
  temps.push(base)
  process.env.QCTL_CACHE_HOME = join(base, 'cache')
  process.env.QCTL_DATA_HOME = join(base, 'data')
})

afterEach(() => {
  process.chdir(origCwd)
  resetRepoRootCache()
  if (origDist === undefined) delete process.env.QCTL_GUEST_DIST
  else process.env.QCTL_GUEST_DIST = origDist
  if (origCache === undefined) delete process.env.QCTL_CACHE_HOME
  else process.env.QCTL_CACHE_HOME = origCache
  if (origData === undefined) delete process.env.QCTL_DATA_HOME
  else process.env.QCTL_DATA_HOME = origData
  if (origSeed === undefined) delete process.env.QCTL_ROCKY_SEED
  else process.env.QCTL_ROCKY_SEED = origSeed
  if (origHome === undefined) delete process.env.HOME
  else process.env.HOME = origHome
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('seed ISO (@gcu/iso9660)', () => {
  test('runSeed writes cidata-labelled Joliet ISO with guest tooling', async () => {
    const base = /** @type {string} */ (temps[0])
    const root = realpathSync(initInstance(join(base, 'inst')).root)
    process.chdir(root)

    const seedKit = join(base, 'seed-kit')
    mkdirSync(join(seedKit, 'cloud-init'), { recursive: true })
    writeFileSync(
      join(seedKit, 'cloud-init', 'user-data.yaml'),
      "hostname: !template '{{ local_hostname }}'\n",
    )
    writeFileSync(
      join(seedKit, 'cloud-init', 'meta-data.yaml'),
      "instance-id: !template '{{ instance_id }}'\n",
    )
    process.env.QCTL_ROCKY_SEED = seedKit

    const dist = join(base, 'dist')
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(dist, 'qctl-guest'), '#!/bin/sh\necho guest\n')
    writeFileSync(
      join(dist, 'qctl-platform-rocky.mjs'),
      [
        "export const FILESYSTEMS = Object.freeze(['xfs', 'ext4'])",
        "export const DEFAULT_FS = 'xfs'",
        "export const OS_DISK = Object.freeze({ id: 'os', size: '20G' })",
        'export const platform = { filesystems: FILESYSTEMS, defaultFs: DEFAULT_FS, osDisk: OS_DISK }',
        '',
      ].join('\n'),
    )
    process.env.QCTL_GUEST_DIST = dist

    const home = join(base, 'home')
    mkdirSync(join(home, '.ssh'), { recursive: true })
    writeFileSync(join(home, '.ssh', 'id_ed25519.pub'), 'ssh-ed25519 AAAATEST test@example\n')
    process.env.HOME = home

    const result = await runSeed({
      profile: 'appliance',
      env: 'dev',
      target: 'local',
      allowMissingTier0: true,
      allowMissingFiles: true,
    })

    const isoPath = result.isoPath
    expect(isoPath).toContain(join('seed', 'dev', 'nocloud.iso'))
    const buf = await Bun.file(isoPath).arrayBuffer()
    const reader = new ISOReader(buf)
    expect(reader.volumeId.trim()).toBe('cidata')
    expect(reader.joliet).toBe(true)
    const listed = reader.list()
    expect(listed).toContain('/user-data')
    expect(listed).toContain('/meta-data')
    expect(listed).toContain('/network-config')
    expect(listed).toContain('/qctl-guest/qctl-guest')
    expect(listed).toContain('/qctl-guest/qctl-platform-rocky.mjs')
    expect(new TextDecoder().decode(reader.read('/qctl-guest/qctl-guest'))).toContain('echo guest')

    const paths = resolveSeedPaths('appliance', 'dev')
    expect(paths.imgPath).toContain('cidata.img')
    expect(await Bun.file(paths.imgPath).exists()).toBe(false)
    expect(getSeed()).toContain('repos')
  })
})
