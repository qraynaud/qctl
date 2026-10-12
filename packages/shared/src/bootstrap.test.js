import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  BOOTSTRAP_DIR_DEFAULT,
  BOOTSTRAP_INSTANCE_DIR,
  instanceBootstrapDir,
  loadBootstrapGraph,
  resolveBootstrapDir,
} from './bootstrap.js'
import { makeTempDir, removeTempDir } from './test-helpers.js'
import { resolvedSensitive } from './varlock/index.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('bootstrap helpers', () => {
  test('resolveBootstrapDir defaults and overrides', () => {
    expect(resolveBootstrapDir()).toBe(BOOTSTRAP_DIR_DEFAULT)
    expect(resolveBootstrapDir('/tmp/x')).toBe('/tmp/x')
  })

  test('instanceBootstrapDir', () => {
    const root = makeTempDir()
    temps.push(root)
    expect(instanceBootstrapDir(root)).toBeNull()
    mkdirSync(join(root, BOOTSTRAP_INSTANCE_DIR))
    expect(instanceBootstrapDir(root)).toBe(join(root, BOOTSTRAP_INSTANCE_DIR))
  })

  test('loadBootstrapGraph loads baked-style schema + .env.dev', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    writeFileSync(join(dir, '.env.schema'), ['TANK_PASSPHRASE=', 'DEPLOY_KEY=', ''].join('\n'))
    writeFileSync(
      join(dir, '.env.dev'),
      ['TANK_PASSPHRASE=lab-pass', 'DEPLOY_KEY=lab-key', ''].join('\n'),
    )

    const graph = await loadBootstrapGraph({
      dir,
      env: { PATH: '/usr/bin' },
      qctlEnv: 'dev',
      skipCache: true,
    })
    expect(resolvedSensitive(graph)).toEqual([
      { key: 'DEPLOY_KEY', value: 'lab-key' },
      { key: 'TANK_PASSPHRASE', value: 'lab-pass' },
    ])
  })

  test('loadBootstrapGraph errors when a required key is missing', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    writeFileSync(join(dir, '.env.schema'), ['TANK_PASSPHRASE=', ''].join('\n'))
    writeFileSync(join(dir, '.env.dev'), '# ---\n')

    await expect(
      loadBootstrapGraph({
        dir,
        env: { PATH: '/usr/bin' },
        qctlEnv: 'dev',
        skipCache: true,
      }),
    ).rejects.toThrow(/TANK_PASSPHRASE/)
  })
})
