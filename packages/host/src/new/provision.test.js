import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadQctlHostMeta } from '@qctl/shared'
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from '../init.js'
import { scaffoldNewProfile } from './prompt.js'
import { listEnvYamlNames, newEnv, newProfile } from './provision.js'
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

describe('newProfile', () => {
  test('registers profile and writes profile layer', () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'lab'))

    const result = newProfile('pve', {
      cwd: instance,
      env: 'dev',
      target: 'proxmox',
      setDefault: true,
    })
    expect(result.written.some((w) => w.includes('common.yaml'))).toBe(true)
    expect(existsSync(join(instance, 'provision', 'profile-pve.yaml'))).toBe(true)

    const meta = loadQctlHostMeta(instance)
    expect(meta.profiles.pve).toEqual({ env: 'dev', target: 'proxmox' })
    expect(meta.defaultProfile).toBe('pve')
  })

  test('rejects unknown env', () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'lab'))
    expect(() => newProfile('x', { cwd: instance, env: 'missing', target: 'proxmox' })).toThrow(
      /environments/,
    )
  })

  test('scaffoldNewProfile applies Proxmox overlay defaults over stub', () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'lab'))
    const result = scaffoldNewProfile(
      {
        name: 'pve',
        force: false,
        yes: true,
        env: 'dev',
        target: 'proxmox',
        setDefault: false,
        skipOverlays: false,
        overlays: {
          proxmox: {
            apiUrl: 'https://pve.lab:8006',
            node: 'pve',
            cpu: 4,
            memory: 8192,
            apiToken: { kind: 'secret', name: 'PROXMOX_API_TOKEN', encoding: 'utf8' },
            net: { eth0: { bridge: 'vmbr0' } },
          },
        },
      },
      { cwd: instance },
    )
    expect(result.overlayWritten).toBe(true)
    const target = readFileSync(join(instance, 'provision', 'target-proxmox.yaml'), 'utf8')
    expect(target).toContain('https://pve.lab:8006')
    expect(target).toMatch(/cpu:\s*4/)
    expect(target).toContain('!env')
    const schema = readFileSync(join(instance, 'provision', '.env.schema'), 'utf8')
    expect(schema).toContain('PROXMOX_API_TOKEN')
  })
})
