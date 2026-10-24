/**
 * Pre-rendered scaffold samples for tests (production uses {@link loadScaffoldTemplate}).
 */
import { defaultProvisionTemplateVars, loadScaffoldTemplate } from './templates.js'

export const GITIGNORE = loadScaffoldTemplate('.gitignore')
export const ROOT_ENV_SCHEMA = loadScaffoldTemplate('.env.schema')
export const ROOT_ENV_DEV = loadScaffoldTemplate('.env.dev')
export const PROVISION_COMMON_YAML = loadScaffoldTemplate('provision/common.yaml', {
  qctl: {
    platform: 'rocky',
    environments: { dev: {} },
    profiles: { lab: { env: 'dev', target: 'workstation' } },
  },
  shared: null,
})
export const PROVISION_DEV_YAML = loadScaffoldTemplate(
  'provision/env-dev.yaml',
  defaultProvisionTemplateVars(),
)
export const PROVISION_README = loadScaffoldTemplate('provision/README.md')
export const PROVISION_ENV_SCHEMA = loadScaffoldTemplate('provision/.env.schema')
