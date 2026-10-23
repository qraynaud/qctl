import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadQctlHostMeta, resolveProfile } from '@qctl/shared'
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  defaultQuickstartProvisionMeta,
  renderCommonYaml,
  writeProvision,
} from './write-provision.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('renderCommonYaml', () => {
  test('emits platform, environments, profiles (sole profile omits default-profile)', () => {
    const text = renderCommonYaml(defaultQuickstartProvisionMeta())
    expect(text).toContain('platform: rocky')
    expect(text).toContain('lab:')
    expect(text).toContain('target: workstation')
    expect(text).not.toContain('default-profile:')
    expect(text).toMatch(/environments:[\s\S]*dev:/)
  })

  test('writes explicit default-profile: null', () => {
    const text = renderCommonYaml({
      ...defaultQuickstartProvisionMeta(),
      defaultProfile: null,
    })
    expect(text).toContain('default-profile: null')
  })

  test('marks production envs and merges shared topology', () => {
    const text = renderCommonYaml({
      platform: 'rocky',
      environments: {
        lab: {},
        prod: { production: true },
      },
      profiles: {
        lab: { env: 'lab', target: 'workstation' },
        prod: { env: 'prod', target: 'proxmox' },
      },
      defaultProfile: 'lab',
      sharedTopology: {
        networking: {
          ports: { ssh: { port: 22 } },
        },
      },
    })
    expect(text).toContain('production: true')
    expect(text).toContain('networking:')
    expect(text).toContain('ssh:')
  })
})

describe('writeProvision', () => {
  test('greenfield quickstart meta is loadable via resolveProfile', () => {
    const root = makeTempDir()
    temps.push(root)
    const report = writeProvision(root, {
      meta: defaultQuickstartProvisionMeta(),
      extraTargets: ['proxmox'],
    })
    expect(report.written).toContain('provision/common.yaml')
    expect(report.written).toContain('provision/env-dev.yaml')
    expect(report.written).toContain('provision/target-workstation.yaml')
    expect(report.written).toContain('provision/target-proxmox.yaml')
    expect(report.written).toContain('provision/profile-lab.yaml')
    expect(existsSync(join(root, 'provision', '.env.schema'))).toBe(true)

    const meta = loadQctlHostMeta(root)
    expect(meta.defaultProfile).toBe('lab')
    expect(resolveProfile({ root })).toEqual({
      key: 'lab',
      env: 'dev',
      target: 'workstation',
      production: false,
    })
  })

  test('ensure skips existing common.yaml unless force', () => {
    const root = makeTempDir()
    temps.push(root)
    writeProvision(root, { meta: defaultQuickstartProvisionMeta() })
    writeFileSync(join(root, 'provision', 'common.yaml'), 'qctl:\n  platform: rocky\n', 'utf8')
    const again = writeProvision(root, { meta: defaultQuickstartProvisionMeta() })
    expect(again.skipped).toContain('provision/common.yaml')
    expect(readFileSync(join(root, 'provision', 'common.yaml'), 'utf8')).toBe(
      'qctl:\n  platform: rocky\n',
    )
    const forced = writeProvision(root, {
      force: true,
      meta: defaultQuickstartProvisionMeta(),
    })
    expect(forced.written).toContain('provision/common.yaml')
    const forcedCommon = readFileSync(join(root, 'provision', 'common.yaml'), 'utf8')
    expect(forcedCommon).toContain('lab:')
    expect(forcedCommon).not.toContain('default-profile:')
    expect(resolveProfile({ root })).toMatchObject({ key: 'lab' })
  })

  test('multi-env shared topology lands in common.yaml', () => {
    const root = makeTempDir()
    temps.push(root)
    writeProvision(root, {
      meta: {
        platform: 'rocky',
        environments: { a: {}, b: { production: true } },
        profiles: {
          a: { env: 'a', target: 'workstation' },
          b: { env: 'b', target: 'workstation' },
        },
        defaultProfile: 'a',
        sharedTopology: {
          networking: { uplinks: { eth0: { dhcp4: true } } },
        },
      },
    })
    const common = readFileSync(join(root, 'provision', 'common.yaml'), 'utf8')
    expect(common).toContain('uplinks:')
    expect(existsSync(join(root, 'provision', 'env-a.yaml'))).toBe(true)
    expect(existsSync(join(root, 'provision', 'env-b.yaml'))).toBe(true)
    expect(existsSync(join(root, 'provision', 'target-workstation.yaml'))).toBe(true)
    expect(existsSync(join(root, 'provision', 'profile-a.yaml'))).toBe(true)
    expect(existsSync(join(root, 'provision', 'profile-b.yaml'))).toBe(true)
  })
})
