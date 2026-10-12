import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { getRockySeedRoot, isEmbeddedSeedRoot, isSeedRoot, workspaceSeedRoot } from './seed-root.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []
const prevSeed = process.env.QCTL_ROCKY_SEED

afterEach(() => {
  if (prevSeed === undefined) delete process.env.QCTL_ROCKY_SEED
  else process.env.QCTL_ROCKY_SEED = prevSeed
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('seed-root', () => {
  test('isSeedRoot checks cloud-init/user-data.yaml', () => {
    const dir = makeTempDir()
    temps.push(dir)
    expect(isSeedRoot(dir)).toBe(false)
    mkdirSync(join(dir, 'cloud-init'), { recursive: true })
    writeFileSync(join(dir, 'cloud-init', 'user-data.yaml'), '#cloud-config\n')
    expect(isSeedRoot(dir)).toBe(true)
  })

  test('isEmbeddedSeedRoot detects $bunfs paths', () => {
    expect(isEmbeddedSeedRoot('/$bunfs/root/seed')).toBe(true)
    expect(isEmbeddedSeedRoot('/home/x/seed')).toBe(false)
  })

  test('getRockySeedRoot prefers QCTL_ROCKY_SEED when valid', () => {
    const dir = makeTempDir()
    temps.push(dir)
    mkdirSync(join(dir, 'cloud-init'), { recursive: true })
    writeFileSync(join(dir, 'cloud-init', 'user-data.yaml'), '#cloud-config\n')
    process.env.QCTL_ROCKY_SEED = dir
    expect(getRockySeedRoot()).toBe(dir)
  })

  test('workspaceSeedRoot points at packages/host/seed', () => {
    expect(workspaceSeedRoot()).toMatch(/packages\/host\/seed$/)
  })
})
