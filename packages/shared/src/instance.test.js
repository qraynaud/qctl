import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { findInstanceRoot, hasQctlProvision, isInstanceRoot } from './instance.js'
import { makeTempDir, removeTempDir, writeMinimalInstance } from './test-helpers.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('instance root detection', () => {
  test('hasQctlProvision / isInstanceRoot', () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    expect(hasQctlProvision(root)).toBe(true)
    expect(isInstanceRoot(root)).toBe(true)
  })

  test('false without provision or qctl: key', () => {
    const root = makeTempDir()
    temps.push(root)
    expect(hasQctlProvision(root)).toBe(false)

    mkdirSync(join(root, 'provision'), { recursive: true })
    writeFileSync(join(root, 'provision', 'env-dev.yaml'), 'networking: {}\n', 'utf8')
    expect(hasQctlProvision(root)).toBe(false)
  })

  test('findInstanceRoot walks upward', () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    const nested = join(root, 'applications', 'foo')
    mkdirSync(nested, { recursive: true })
    expect(findInstanceRoot(nested)).toBe(root)
  })

  test('findInstanceRoot returns null when none', () => {
    const root = makeTempDir()
    temps.push(root)
    expect(findInstanceRoot(root)).toBeNull()
  })

  test('ignores invalid yaml while scanning', () => {
    const root = makeTempDir()
    temps.push(root)
    mkdirSync(join(root, 'provision'), { recursive: true })
    writeFileSync(join(root, 'provision', 'broken.yaml'), ':\n  -', 'utf8')
    writeFileSync(join(root, 'provision', 'env-dev.yaml'), 'qctl:\n  platform: rocky\n', 'utf8')
    expect(hasQctlProvision(root)).toBe(true)
  })
})
