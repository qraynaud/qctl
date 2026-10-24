import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { readOsConfig, tryReadOsConfig } from './os-config.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { OsConfig } from '@qctl/shared' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

/** @returns {OsConfig} */
function sampleOs() {
  return {
    env: 'dev',
    root: '/tank/rocky',
    repo: { vcs: 'hg' },
    quadletUser: 'apps',
    apps: {
      username: 'apps',
      uid: 1000,
      gid: 1000,
      subuid: { start: 900000, count: 65536 },
      subgid: { start: 900000, count: 65536 },
    },
    timezone: 'Europe/Paris',
    profile: 'appliance',
  }
}

describe('os-config', () => {
  test('readOsConfig parses / write round-trip path', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const path = join(dir, 'config.json')
    writeFileSync(path, `${JSON.stringify(sampleOs(), null, 2)}\n`)
    expect(readOsConfig(path).quadletUser).toBe('apps')
    expect(tryReadOsConfig(join(dir, 'missing.json'))).toBeUndefined()
  })

  test('readOsConfig rejects secrets / seed-only fields', () => {
    const dir = makeTempDir()
    temps.push(dir)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'bad.json')
    writeFileSync(path, JSON.stringify({ ...sampleOs(), tier0Keys: ['X'] }))
    expect(() => readOsConfig(path)).toThrow(/failed to read OS config/)
  })
})
