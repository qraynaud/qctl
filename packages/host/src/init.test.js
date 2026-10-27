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
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from './init.js'
import {
  appsIdentityFromProvision,
  firstBootCredentialsFromProvision,
  provisionSchema,
} from './provision/schema/index.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { YamlMapping } from '@qctl/shared' */

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
    expect(readFileSync(join(result.root, 'provision', '.env.schema'), 'utf8')).not.toContain(
      'TANK_PASSPHRASE=',
    )
    expect(readFileSync(join(result.root, 'provision', '.env.schema'), 'utf8')).toContain(
      '!env NAME',
    )
    expect(existsSync(join(result.root, 'provision', 'common.yaml'))).toBe(true)
    expect(existsSync(join(result.root, 'provision', 'env-dev.yaml'))).toBe(true)
    expect(readFileSync(join(result.root, 'provision', 'common.yaml'), 'utf8')).toContain(
      'platform: rocky',
    )
    expect(readFileSync(join(result.root, '.env.schema'), 'utf8')).toContain('@type=string')
    expect(readFileSync(join(result.root, '.env.schema'), 'utf8')).not.toContain('enum(dev, prod)')
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
      target: 'workstation',
      profile: 'lab',
      resolve: false,
    })
    expect(envRefs).toEqual([])
    const prov = readFileSync(join(result.root, 'provision', 'env-dev.yaml'), 'utf8')
    expect(prov).toMatch(/^disks:/m)
    expect(prov).toContain('tanks:')
    expect(prov).toContain('role: data')
    expect(prov).toContain('passphrase: lab-tank-passphrase')
    expect(prov).not.toContain('!env TANK_PASSPHRASE')
    expect(prov).not.toMatch(/^tank:/m)
    const readme = readFileSync(join(result.root, 'provision', 'README.md'), 'utf8')
    expect(readme).toContain('disks.tanks')
    expect(readme).not.toMatch(/`tank`/)

    // Resolved local provision must validate (users omitted → schema defaults).
    const loaded = await loadProvision({
      root: result.root,
      env: 'dev',
      target: 'workstation',
      profile: 'lab',
      processEnv: { ...process.env, QCTL_ENV: 'dev' },
    })
    const data = provisionSchema.parse(loaded.data)
    expect(data.users.admin).toMatchObject({ username: 'admin', uid: 1000, gid: 1000 })
    expect(appsIdentityFromProvision(data)).toMatchObject({
      username: 'apps',
      uid: 900,
      subuidSpec: '900000:32768',
    })
    const tier0 = firstBootCredentialsFromProvision(data)
    expect(tier0.tank_passphrase_tank).toBeTruthy()
    expect(tier0.ADMIN_USERNAME).toBe('admin')
    expect(tier0.ADMIN_PASSWORD).toBeUndefined()
  })

  test('scaffolded schema + .env.dev/.env.prod load through the varlock graph (no .env.<env> auto-load)', async () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: dir } = initInstance(join(root, 'demo'))
    expect(existsSync(join(dir, 'package.json'))).toBe(true)
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
      TZ: 'UTC',
    })
    expect(resolvedNonSensitive(dev, { includeInternal: true }).APP_ROOT).toBeUndefined()
    expect(resolvedNonSensitive(dev).ENV).toBeUndefined() // @internal
    expect(sensitiveKeys(dev)).not.toContain('VW_CLIENT_ID')

    // Provision schema ships empty of catalog keys; Secret slots add them later.
    const hostGraph = await loadEnvGraph({
      entryFilePaths: [join(dir, 'provision')],
      currentEnvFallback: 'dev',
      processEnvOverride: env,
      skipCache: true,
    })
    expect(sensitiveKeys(hostGraph)).not.toContain('TANK_PASSPHRASE')

    const prod = await loadEnvGraphForDir(dir, {
      env,
      qctlEnv: 'prod',
      skipSensitive: true,
      skipCache: true,
    })
    expect(resolvedNonSensitive(prod, { includeInternal: true })).toMatchObject({
      ENV: 'prod',
      TZ: 'UTC',
    })
    expect(resolvedNonSensitive(prod, { includeInternal: true }).APP_ROOT).toBeUndefined()
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
