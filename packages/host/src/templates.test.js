import {
  GITIGNORE,
  PROVISION_COMMON_YAML,
  PROVISION_DEV_YAML,
  PROVISION_ENV_SCHEMA,
  PROVISION_README,
  ROOT_ENV_DEV,
  ROOT_ENV_SCHEMA,
  packageReadme,
  treeEnvSchema,
} from './templates.js'
import { describe, expect, test } from 'bun:test'

describe('scaffold templates', () => {
  test('static scaffolds include expected anchors', () => {
    expect(GITIGNORE).toContain('.env.local')
    expect(GITIGNORE).toContain('--profile')
    expect(PROVISION_ENV_SCHEMA).toContain('TANK_PASSPHRASE=')
    expect(PROVISION_ENV_SCHEMA).toContain('tank_passphrase_<id>')
    expect(ROOT_ENV_DEV).toContain('ENV=dev')
    expect(ROOT_ENV_SCHEMA).toContain('@type=string')
    expect(ROOT_ENV_SCHEMA).not.toContain('enum(dev, prod)')
  })

  test('common.yaml has platform and optional profiles comment', () => {
    expect(PROVISION_COMMON_YAML).toContain('platform: rocky')
    expect(PROVISION_COMMON_YAML).toContain('profiles:')
    expect(PROVISION_COMMON_YAML).toContain('default-profile:')
    expect(PROVISION_COMMON_YAML).toMatch(/#\s*environments:/)
  })

  test('provision scaffold uses disks topology (no top-level tank)', () => {
    expect(PROVISION_DEV_YAML).toMatch(/^disks:/m)
    expect(PROVISION_DEV_YAML).toContain('tanks:')
    expect(PROVISION_DEV_YAML).toContain('role: data')
    expect(PROVISION_DEV_YAML).toContain('role: special')
    expect(PROVISION_DEV_YAML).toContain('passphrase: !env TANK_PASSPHRASE')
    expect(PROVISION_DEV_YAML).not.toMatch(/^tank:/m)
    expect(PROVISION_DEV_YAML).not.toMatch(/^qctl:/m)
    expect(PROVISION_README).toContain('disks.tanks')
    expect(PROVISION_README).toContain('init-tank')
    expect(PROVISION_README).toContain('common.yaml')
    expect(PROVISION_README).toContain('--profile')
    expect(PROVISION_README).not.toMatch(/`tank`/)
  })

  test('treeEnvSchema imports root and package-local files', () => {
    const app = treeEnvSchema('applications', 'web')
    expect(app).toContain('# @import(../../)')
    expect(app).toContain('# @import(./.env.app, allowMissing=true)')
    expect(app).toContain('# @import(./.env.web, allowMissing=true)')

    const common = treeEnvSchema('common', 'lib')
    expect(common).not.toContain('# @import(./.env.app')
    expect(common).toContain('# @import(./.env.lib, allowMissing=true)')
  })

  test('packageReadme maps kind to qctl new subcommand', () => {
    expect(packageReadme('applications', 'web')).toContain('qctl new app web')
    expect(packageReadme('networks', 'vlan')).toContain('qctl new network vlan')
    expect(packageReadme('common', 'lib')).toContain('qctl new common lib')
  })
})
