import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadQctlHostMeta } from '@qctl/shared'
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from '../init.js'
import { listEnvYamlNames, newEnv } from './provision.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('newEnv', () => {
  test('registers environment and writes env layer + .env file', () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'lab'))

    const result = newEnv('staging', { cwd: instance, production: true })
    expect(result.written.some((w) => w.includes('common.yaml'))).toBe(true)
    expect(existsSync(join(instance, 'provision', 'env-staging.yaml'))).toBe(true)
    expect(existsSync(join(instance, 'provision', '.env.staging'))).toBe(true)

    const meta = loadQctlHostMeta(instance)
    expect(meta.environments.staging).toEqual({ production: true })
    expect(listEnvYamlNames(instance)).toContain('staging')
  })

  test('--from copies existing env yaml', () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'lab'))
    // init writes env-dev.yaml
    const result = newEnv('copy', { cwd: instance, from: 'dev' })
    const text = readFileSync(join(instance, 'provision', 'env-copy.yaml'), 'utf8')
    expect(text).toBe(readFileSync(join(instance, 'provision', 'env-dev.yaml'), 'utf8'))
    expect(result.written).toContain('provision/env-copy.yaml')
  })

  test('skips existing without --force', () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'lab'))
    newEnv('staging', { cwd: instance })
    const again = newEnv('staging', { cwd: instance })
    expect(again.skipped.length).toBeGreaterThan(0)
  })
})
