import {
  GITIGNORE,
  PROVISION_COMMON_YAML,
  PROVISION_DEV_YAML,
  PROVISION_ENV_SCHEMA,
  PROVISION_README,
  ROOT_ENV_DEV,
  ROOT_ENV_SCHEMA,
  packageReadme,
  readScaffoldTemplate,
  renderTemplate,
  treeEnvSchema,
} from './templates.js'
import { describe, expect, test } from 'bun:test'

describe('scaffold templates', () => {
  test('static scaffolds include expected anchors', () => {
    expect(GITIGNORE).toContain('.env.local')
    expect(GITIGNORE).toContain('--profile')
    expect(PROVISION_ENV_SCHEMA).not.toContain('TANK_PASSPHRASE=')
    expect(PROVISION_ENV_SCHEMA).toContain('!env NAME')
    expect(PROVISION_ENV_SCHEMA).toContain('.env.<env>')
    expect(ROOT_ENV_DEV).toContain('ENV=dev')
    expect(ROOT_ENV_SCHEMA).toContain('@type=string')
    expect(ROOT_ENV_SCHEMA).not.toContain('enum(dev, prod)')
  })

  test('common.yaml sample renders qctl via | yaml | indent', () => {
    expect(PROVISION_COMMON_YAML).toContain('platform: rocky')
    expect(PROVISION_COMMON_YAML).toContain('profiles:')
    expect(PROVISION_COMMON_YAML).toContain('lab:')
    expect(PROVISION_COMMON_YAML).toContain('target: workstation')
    expect(PROVISION_COMMON_YAML).toMatch(/environments:[\s\S]*dev:/)
  })

  test('provision scaffold matches Custom Enter defaults (no vw, raidz×2, no vlan)', () => {
    expect(PROVISION_DEV_YAML).toMatch(/^disks:/m)
    expect(PROVISION_DEV_YAML).toContain('tanks:')
    expect(PROVISION_DEV_YAML).toContain('role: data')
    expect(PROVISION_DEV_YAML).toContain('type: raidz')
    expect(PROVISION_DEV_YAML).toContain('data1: { size: 2G }')
    expect(PROVISION_DEV_YAML).toContain('data2: { size: 2G }')
    expect(PROVISION_DEV_YAML).not.toContain('role: special')
    expect(PROVISION_DEV_YAML).not.toContain('raidz2')
    // No live data.vw block (comments may still mention /vw)
    expect(PROVISION_DEV_YAML).not.toMatch(/^ {2}data:/m)
    expect(PROVISION_DEV_YAML).not.toMatch(/^ {4}vw:/m)
    expect(PROVISION_DEV_YAML).toContain('passphrase: lab-tank-passphrase')
    expect(PROVISION_DEV_YAML).not.toContain('!env TANK_PASSPHRASE')
    expect(PROVISION_DEV_YAML).not.toMatch(/^tank:/m)
    expect(PROVISION_DEV_YAML).not.toMatch(/^qctl:/m)
    expect(PROVISION_DEV_YAML).toContain('forward: 2222')
    expect(PROVISION_DEV_YAML).toContain('eth0:')
    expect(PROVISION_DEV_YAML).not.toMatch(/^\s+vlan2:/m)
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

  test('readScaffoldTemplate loads .njk files from templates/', () => {
    expect(readScaffoldTemplate('.gitignore')).toContain('.env.local')
    expect(readScaffoldTemplate('provision/common.yaml.njk')).toContain('qctl | yaml | indent(2)')
  })

  test('renderTemplate uses nunjucks {{ vars }} and rejects undefined', () => {
    expect(renderTemplate('hi {{ name }}', { name: 'x' })).toBe('hi x')
    expect(() => renderTemplate('{{ missing }}', {})).toThrow(/scaffold template render failed/)
  })

  test('yaml + indent filters nest objects under a key', () => {
    const out = renderTemplate('qctl:\n{{ qctl | yaml | indent(2) }}\n', {
      qctl: { platform: 'rocky', environments: { dev: {} } },
    })
    expect(out).toContain('qctl:\n  platform: rocky\n  environments:\n    dev: {}')
  })
})
