import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadEnvGraphForDir, resolvedNonSensitive } from '@qctl/shared'
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from './init.js'
import { newPackage } from './new.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('newPackage', () => {
  test('creates app / common / network with .env.schema', () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'demo'))

    const app = newPackage('app', 'my-app', { cwd: instance })
    expect(app.path).toBe(join(instance, 'applications', 'my-app'))
    expect(existsSync(join(app.path, '.env.schema'))).toBe(true)
    expect(readFileSync(join(app.path, 'README.md'), 'utf8')).toContain('my-app')

    const common = newPackage('common', 'lib-x', { cwd: instance })
    expect(common.path).toContain(`${join('common', 'lib-x')}`)

    const net = newPackage('network', 'vlan2', { cwd: instance })
    expect(net.path).toContain(`${join('networks', 'vlan2')}`)
  })

  test('scaffolded app schema imports root/defaults/.env.app/.env.<name> by path and loads', async () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'demo'))
    const app = newPackage('app', 'my-app', { cwd: instance })
    const schema = readFileSync(join(app.path, '.env.schema'), 'utf8')
    expect(schema).toContain('# @import(../../)')
    expect(schema).toContain('# @import(./.env.app, allowMissing=true)')
    expect(schema).toContain('# @import(./.env.my-app, allowMissing=true)')
    expect(schema).not.toMatch(/^# @currentEnv/m)
    expect(schema).not.toContain('.env.defaults')

    writeFileSync(join(app.path, '.env.app'), '# @public\nVERSION=1.0\n')
    writeFileSync(join(app.path, '.env.my-app'), '# @public\nGREETING=hi-${ENV}\n')
    const g = await loadEnvGraphForDir(app.path, {
      env: { PATH: process.env.PATH },
      qctlEnv: 'dev',
      skipSensitive: true,
      skipCache: true,
    })
    expect(resolvedNonSensitive(g, { includeInternal: true })).toMatchObject({
      VERSION: '1.0',
      GREETING: 'hi-dev',
      ENV: 'dev',
    })

    const common = newPackage('common', 'lib-x', { cwd: instance })
    const cs = readFileSync(join(common.path, '.env.schema'), 'utf8')
    expect(cs).toContain('# @import(../../)')
    expect(cs).not.toContain('# @import(./.env.app')
    await loadEnvGraphForDir(common.path, {
      env: { PATH: process.env.PATH },
      qctlEnv: 'dev',
      skipSensitive: true,
      skipCache: true,
    })
  })

  test('rejects invalid names', () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'demo'))
    expect(() => newPackage('app', 'Bad_Name', { cwd: instance })).toThrow(/invalid name/)
    expect(() => newPackage('app', '1bad', { cwd: instance })).toThrow(/invalid name/)
  })

  test('requires initialized instance', () => {
    const root = makeTempDir()
    temps.push(root)
    expect(() => newPackage('app', 'x', { cwd: root })).toThrow(/not a qctl instance/)
  })

  test('refuses existing package without force', () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'demo'))
    newPackage('app', 'dup', { cwd: instance })
    expect(() => newPackage('app', 'dup', { cwd: instance })).toThrow(/already exists/)
    const again = newPackage('app', 'dup', { cwd: instance, force: true })
    expect(existsSync(join(again.path, '.env.schema'))).toBe(true)
  })
})
