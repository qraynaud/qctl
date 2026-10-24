import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  FIRST_BOOT_STAMP,
  INIT_TANK_STAMP,
  mergeInitState,
  readInitState,
  resolveInitStatePath,
  writeFileAtomic,
  writeThinStamp,
} from './state.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('init state', () => {
  test('resolveInitStatePath prefers paths.initState', () => {
    expect(resolveInitStatePath({ initState: '/tmp/x.json' })).toBe('/tmp/x.json')
    expect(resolveInitStatePath({})).toBe('/var/lib/qctl/init-state.json')
  })

  test('mergeInitState deep-merges tanks + dataMounts and folds canary', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const path = join(dir, 'init-state.json')
    mergeInitState(
      {
        dataMounts: { vw: { mount: '/vw', preparedAt: '2020-01-01T00:00:00.000Z' } },
        tanks: {
          tank: {
            mount: '/tank',
            canary: { line: 'a\n', writtenAt: '2020-01-01T00:00:00.000Z' },
          },
        },
      },
      { path },
    )
    mergeInitState(
      {
        tanks: {
          tank: {
            mount: '/tank',
            importedAt: '2020-01-02T00:00:00.000Z',
            canary: {
              line: 'a\n',
              writtenAt: '2020-01-01T00:00:00.000Z',
              drillVerifiedAt: '2020-01-02T00:00:00.000Z',
            },
          },
        },
      },
      { path },
    )
    const state = readInitState(path)
    expect(state.dataMounts?.vw.mount).toBe('/vw')
    expect(state.tanks?.tank.importedAt).toBe('2020-01-02T00:00:00.000Z')
    expect(state.tanks?.tank.canary?.drillVerifiedAt).toBe('2020-01-02T00:00:00.000Z')
  })

  test('writeThinStamp writes only the primary path', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const primary = join(dir, FIRST_BOOT_STAMP)
    const written = writeThinStamp(FIRST_BOOT_STAMP, 'ok\n', { primaryPath: primary })
    expect(written).toEqual([primary])
    expect(readFileSync(primary, 'utf8')).toBe('ok\n')
  })

  test('writeThinStamp uses paths.initTankStamp override', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const stamp = join(dir, 'done')
    const written = writeThinStamp(INIT_TANK_STAMP, 'when\n', {
      paths: { initTankStamp: stamp },
    })
    expect(written).toEqual([stamp])
  })

  test('writeFileAtomic replaces via rename', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const path = join(dir, 'x.json')
    writeFileAtomic(path, '{"a":1}\n')
    writeFileAtomic(path, '{"a":2}\n')
    expect(readFileSync(path, 'utf8')).toBe('{"a":2}\n')
  })

  test('readInitState quarantines corrupt JSON and returns empty', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const path = join(dir, 'init-state.json')
    writeFileSync(path, '{"version":1,"hostname":"cut', 'utf8')
    const state = readInitState(path)
    expect(state).toEqual({ version: 1 })
    expect(existsSync(path)).toBe(false)
  })
})
