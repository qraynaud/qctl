import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { listInstanceApps } from './apps.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('listInstanceApps', () => {
  test('returns empty when applications/ is missing', () => {
    const root = makeTempDir()
    temps.push(root)
    expect(listInstanceApps(root)).toEqual([])
  })

  test('lists dirs that have app.yaml, sorted', () => {
    const root = makeTempDir()
    temps.push(root)
    for (const name of ['zeta', 'alpha', 'skip']) {
      const dir = join(root, 'applications', name)
      mkdirSync(dir, { recursive: true })
      if (name !== 'skip') writeFileSync(join(dir, 'app.yaml'), 'name: x\n')
    }
    expect(listInstanceApps(root)).toEqual(['alpha', 'zeta'])
  })
})
