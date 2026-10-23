import { makeTempDir, removeTempDir, writeFile } from '../test-helpers.js'
import {
  BUILTIN_ENVIRONMENTS,
  BUILTIN_PROFILES,
  isProductionEnv,
  isReservedProvisionName,
  loadQctlHostMeta,
  resolveProfile,
} from './profile.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('isReservedProvisionName', () => {
  test('prefixed layers → no reserved env/profile keys', () => {
    expect(isReservedProvisionName('common')).toBe(false)
    expect(isReservedProvisionName('workstation')).toBe(false)
    expect(isReservedProvisionName('proxmox')).toBe(false)
    expect(isReservedProvisionName('dev')).toBe(false)
  })
})

describe('loadQctlHostMeta', () => {
  test('uses built-ins when common.yaml is absent', () => {
    const root = makeTempDir()
    temps.push(root)
    const meta = loadQctlHostMeta(root)
    expect(meta.environments).toEqual(BUILTIN_ENVIRONMENTS)
    expect(meta.profiles).toEqual(BUILTIN_PROFILES)
    expect(meta.defaultProfile).toBe('default')
  })

  test('uses built-ins when common.yaml has no qctl environments/profiles', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(root, 'provision/common.yaml', 'qctl:\n  platform: rocky\n')
    const meta = loadQctlHostMeta(root)
    expect(meta.defaultProfile).toBe('default')
    expect(meta.environments.prod.production).toBe(true)
  })

  test('single custom profile becomes the default', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      'provision/common.yaml',
      [
        'qctl:',
        '  environments:',
        '    lab: {}',
        '  profiles:',
        '    lab: { env: lab, target: workstation }',
        '',
      ].join('\n'),
    )
    const meta = loadQctlHostMeta(root)
    expect(meta.defaultProfile).toBe('lab')
    expect(meta.environments.lab.production).toBe(false)
  })

  test('multi profiles without default-profile → null default', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      'provision/common.yaml',
      [
        'qctl:',
        '  environments:',
        '    dev: {}',
        '    prod: { production: true }',
        '  profiles:',
        '    lab: { env: dev, target: workstation }',
        '    prod: { env: prod, target: proxmox }',
        '',
      ].join('\n'),
    )
    expect(loadQctlHostMeta(root).defaultProfile).toBeNull()
  })

  test('explicit default-profile: null → null even with one profile', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      'provision/common.yaml',
      [
        'qctl:',
        '  environments:',
        '    dev: {}',
        '  profiles:',
        '    lab: { env: dev, target: workstation }',
        '  default-profile: null',
        '',
      ].join('\n'),
    )
    expect(loadQctlHostMeta(root).defaultProfile).toBeNull()
    expect(() => resolveProfile({ root })).toThrow(/profile required/)
  })

  test('honors default-profile', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      'provision/common.yaml',
      [
        'qctl:',
        '  environments:',
        '    dev: {}',
        '    prod: { production: true }',
        '  profiles:',
        '    lab: { env: dev, target: workstation }',
        '    prod: { env: prod, target: proxmox }',
        '  default-profile: lab',
        '',
      ].join('\n'),
    )
    expect(loadQctlHostMeta(root).defaultProfile).toBe('lab')
  })

  test('allows env/profile keys that match former layer basenames', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      'provision/common.yaml',
      [
        'qctl:',
        '  environments:',
        '    workstation: {}',
        '    common: {}',
        '  profiles:',
        '    common: { env: common, target: workstation }',
        '    workstation: { env: workstation, target: workstation }',
        '  default-profile: common',
        '',
      ].join('\n'),
    )
    const meta = loadQctlHostMeta(root)
    expect(meta.environments.workstation).toEqual({ production: false })
    expect(meta.profiles.common).toEqual({ env: 'common', target: 'workstation' })
    expect(meta.defaultProfile).toBe('common')
  })

  test('rejects empty environments map when present', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(root, 'provision/common.yaml', 'qctl:\n  environments: {}\n')
    expect(() => loadQctlHostMeta(root)).toThrow(/must not be empty/)
  })

  test('rejects profile.env not in environments', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      'provision/common.yaml',
      [
        'qctl:',
        '  environments:',
        '    dev: {}',
        '  profiles:',
        '    lab: { env: missing, target: workstation }',
        '',
      ].join('\n'),
    )
    expect(() => loadQctlHostMeta(root)).toThrow(/not in qctl.environments/)
  })

  test('rejects unknown default-profile', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      'provision/common.yaml',
      [
        'qctl:',
        '  environments:',
        '    dev: {}',
        '  profiles:',
        '    lab: { env: dev, target: workstation }',
        '  default-profile: nope',
        '',
      ].join('\n'),
    )
    expect(() => loadQctlHostMeta(root)).toThrow(/default-profile/)
  })
})

describe('isProductionEnv', () => {
  test('reads production flag', () => {
    const envs = {
      dev: { production: false },
      prod: { production: true },
      staging: { production: false },
    }
    expect(isProductionEnv('prod', envs)).toBe(true)
    expect(isProductionEnv('dev', envs)).toBe(false)
    expect(isProductionEnv('staging', envs)).toBe(false)
    expect(isProductionEnv('unknown', envs)).toBe(false)
  })
})

describe('resolveProfile', () => {
  test('resolves built-in default without CLI profile', () => {
    const root = makeTempDir()
    temps.push(root)
    const r = resolveProfile({ root })
    expect(r).toEqual({
      key: 'default',
      env: 'dev',
      target: 'workstation',
      production: false,
    })
  })

  test('CLI profile wins', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      'provision/common.yaml',
      [
        'qctl:',
        '  environments:',
        '    dev: {}',
        '    prod: { production: true }',
        '  profiles:',
        '    lab: { env: dev, target: workstation }',
        '    prod: { env: prod, target: proxmox }',
        '  default-profile: lab',
        '',
      ].join('\n'),
    )
    const r = resolveProfile({ root, profile: 'prod' })
    expect(r).toEqual({
      key: 'prod',
      env: 'prod',
      target: 'proxmox',
      production: true,
    })
  })

  test('errors when multi-profile and no selection', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      'provision/common.yaml',
      [
        'qctl:',
        '  environments:',
        '    dev: {}',
        '    prod: { production: true }',
        '  profiles:',
        '    lab: { env: dev, target: workstation }',
        '    prod: { env: prod, target: proxmox }',
        '',
      ].join('\n'),
    )
    expect(() => resolveProfile({ root })).toThrow(/profile required/)
  })

  test('errors on unknown profile name', () => {
    const root = makeTempDir()
    temps.push(root)
    expect(() => resolveProfile({ root, profile: 'nope' })).toThrow(/unknown profile/)
  })

  test('single custom profile resolves without CLI name', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      'provision/common.yaml',
      [
        'qctl:',
        '  environments:',
        '    lab: {}',
        '  profiles:',
        '    lab: { env: lab, target: workstation }',
        '',
      ].join('\n'),
    )
    expect(resolveProfile({ root })).toEqual({
      key: 'lab',
      env: 'lab',
      target: 'workstation',
      production: false,
    })
  })
})
