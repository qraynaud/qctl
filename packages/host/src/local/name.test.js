import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '../../../shared/src/test-helpers.js'
import { localContainerName, localTestContainerName } from './name.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []
afterEach(() => {
  while (temps.length) {
    const d = temps.pop()
    if (d) removeTempDir(d)
  }
})

describe('localContainerName', () => {
  test('includes folder basename and stable hash', () => {
    const root = makeTempDir()
    temps.push(root)
    const named = join(root, 'my-rocky')
    mkdirSync(named)
    const a = localContainerName(named)
    const b = localContainerName(named)
    expect(a).toBe(b)
    expect(a).toMatch(/^qctl-local-my-rocky-[0-9a-f]{8}$/)
  })

  test('sanitizes odd folder names', () => {
    const root = makeTempDir()
    temps.push(root)
    const named = join(root, 'weird name!!')
    mkdirSync(named)
    const n = localContainerName(named)
    expect(n).toMatch(/^qctl-local-weird-name-[0-9a-f]{8}$/)
  })
})

describe('localTestContainerName', () => {
  test('appends -test-<id> to the stable name', () => {
    const root = makeTempDir()
    temps.push(root)
    const named = join(root, 'my-rocky')
    mkdirSync(named)
    const base = localContainerName(named)
    const a = localTestContainerName(named, 'deadbeef')
    const b = localTestContainerName(named, 'cafebabe')
    expect(a).toBe(`${base}-test-deadbeef`)
    expect(b).toBe(`${base}-test-cafebabe`)
    expect(a).not.toBe(b)
  })
})
