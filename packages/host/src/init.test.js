import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  isInstanceRoot,
  loadEnvGraph,
  loadEnvGraphForDir,
  loadProvision,
  resolvedNonSensitive,
  sensitiveKeys,
} from '@qctl/shared'

import { makeTempDir, removeTempDir } from '../../shared/src/test-helpers.js'
import { initInstance } from './init.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('initInstance', () => {
  test('scaffolds mise, schema, provision, trees', async () => {
    const root = makeTempDir()
    temps.push(root)

    const result = initInstance(join(root, 'demo'))
    expect(result.written.length).toBeGreaterThan(5)
    expect(isInstanceRoot(result.root)).toBe(true)

    expect(existsSync(join(result.root, 'mise.toml'))).toBe(true)
    expect(existsSync(join(result.root, '.env.schema'))).toBe(true)
    expect(existsSync(join(result.root, 'provision', '.env.schema'))).toBe(true)
    expect(existsSync(join(result.root, 'provision', '.env.dev'))).toBe(true)
    expect(existsSync(join(result.root, 'provision', '.env.prod'))).toBe(true)
    expect(readFileSync(join(result.root, 'provision', '.env.schema'), 'utf8')).toContain(
      'TANK_PASSPHRASE=',
    )
    expect(existsSync(join(result.root, 'provision', 'dev.yaml'))).toBe(true)
    expect(existsSync(join(result.root, 'applications', '.gitkeep'))).toBe(true)

    const mise = readFileSync(join(result.root, 'mise.toml'), 'utf8')
    expect(mise).not.toContain('github:dmno-dev/varlock')
    expect(mise).toContain('github:qraynaud/qctl')
    expect(mise).toContain('bin = "qctl"')
    expect(mise).not.toContain('[bootstrap.packages]')
    expect(mise).toContain('bundled ISO writer')

    const { envRefs } = await loadProvision({
      root: result.root,
      env: 'dev',
      target: 'local',
      resolve: false,
    })
    expect(envRefs.length).toBeGreaterThan(0)
    const prov = readFileSync(join(result.root, 'provision', 'dev.yaml'), 'utf8')
    expect(prov).toContain('tank:')
    expect(prov).toContain('!env TANK_PASSPHRASE')
  })

  test('scaffolded schema + .env.dev/.env.prod load through the varlock graph (no .env.<env> auto-load)', async () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: dir } = initInstance(join(root, 'demo'))
    expect(existsSync(join(dir, '.env.dev'))).toBe(true)
    expect(existsSync(join(dir, '.env.prod'))).toBe(true)
    const prodFile = readFileSync(join(dir, '.env.prod'), 'utf8')
    expect(prodFile).toContain('@qctl/vaultwarden-plugin')
    expect(prodFile).not.toMatch(/^# @plugin\(/m)
    expect(prodFile).not.toMatch(/^# @initVw\(/m)
    expect(existsSync(join(dir, 'applications', '.env.defaults'))).toBe(false)
    expect(existsSync(join(dir, 'applications', '.env.dev.defaults'))).toBe(false)
    expect(existsSync(join(dir, 'networks', '.env.defaults'))).toBe(false)

    const env = { PATH: process.env.PATH }
    const dev = await loadEnvGraphForDir(dir, {
      env,
      qctlEnv: 'dev',
      skipSensitive: true,
      skipCache: true,
    })
    expect(resolvedNonSensitive(dev)).toMatchObject({ QCTL_ENV: 'dev' })
    expect(resolvedNonSensitive(dev, { includeInternal: true })).toMatchObject({
      ENV: 'dev',
      TANK_ROOT: './volumes',
    })
    expect(resolvedNonSensitive(dev).ENV).toBeUndefined() // @internal
    expect(sensitiveKeys(dev)).not.toContain('VW_CLIENT_ID')

    const hostOverrides = {
      ...env,
      QCTL_ENV: 'dev',
      TANK_PASSPHRASE: 'lab-tank',
      DEPLOY_KEY: 'lab-deploy',
    }
    const hostGraph = await loadEnvGraph({
      entryFilePaths: [join(dir, 'provision')],
      currentEnvFallback: 'dev',
      overrideValues: hostOverrides,
      processEnvOverride: env,
      skipCache: true,
    })
    expect(sensitiveKeys(hostGraph)).toContain('TANK_PASSPHRASE')
    const { env: hostEnv } = await (await import('@qctl/shared')).loadHostEnvDetailed(
      dir,
      hostOverrides,
    )
    expect(hostEnv.TANK_PASSPHRASE).toBe('lab-tank')

    const prod = await loadEnvGraphForDir(dir, {
      env,
      qctlEnv: 'prod',
      skipSensitive: true,
      skipCache: true,
    })
    expect(resolvedNonSensitive(prod, { includeInternal: true })).toMatchObject({
      ENV: 'prod',
      TANK_ROOT: '/tank/apps',
    })
  })
  test('refuses to re-init without --force', () => {
    const root = makeTempDir()
    temps.push(root)
    const dir = join(root, 'demo')
    initInstance(dir)
    expect(() => initInstance(dir)).toThrow(/already looks like a qctl instance/)
  })

  test('--force overwrites and reports skipped vs written', () => {
    const root = makeTempDir()
    temps.push(root)
    const dir = join(root, 'demo')
    initInstance(dir)
    const again = initInstance(dir, { force: true })
    expect(again.written.length).toBeGreaterThan(0)
    expect(again.skipped).toEqual([])
  })
})
