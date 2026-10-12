import {
  GITIGNORE,
  PROVISION_ENV_SCHEMA,
  ROOT_ENV_DEV,
  packageReadme,
  treeEnvSchema,
} from './templates.js'
import { describe, expect, test } from 'bun:test'

describe('scaffold templates', () => {
  test('static scaffolds include expected anchors', () => {
    expect(GITIGNORE).toContain('.env.local')
    expect(PROVISION_ENV_SCHEMA).toContain('TANK_PASSPHRASE=')
    expect(ROOT_ENV_DEV).toContain('ENV=dev')
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
