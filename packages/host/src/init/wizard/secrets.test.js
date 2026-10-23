import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  applySecretsAnswers,
  collectProjectSecrets,
  syncSchemaFromProvisionYaml,
} from './secrets.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('collectProjectSecrets', () => {
  test('dedupes secret bindings across sections', () => {
    const slots = collectProjectSecrets({
      disks: {
        sharedStructure: true,
        byProfile: {
          lab: {
            os: { kind: 'virtual', size: '20G' },
            data: {},
            tanks: {
              tank: {
                mount: '/tank',
                passphrase: {
                  kind: 'secret',
                  name: 'TANK_PASSPHRASE',
                  encoding: 'utf8',
                  value: 'x',
                },
                options: null,
                vdevs: {},
              },
            },
          },
        },
      },
      usersSsh: {
        shared: false,
        users: null,
        authorizedKeys: null,
        hostKeys: { kind: 'secret', name: 'SSH_HOST_KEYS', encoding: 'base64' },
      },
      repoReg: {
        shared: false,
        repo: null,
        registries: [{ kind: 'secret', name: 'HEPTAPOD_REGISTRY', encoding: 'utf8' }],
      },
    })
    expect(slots.map((s) => s.name)).toEqual([
      'HEPTAPOD_REGISTRY',
      'SSH_HOST_KEYS',
      'TANK_PASSPHRASE',
    ])
    expect(slots.find((s) => s.name === 'TANK_PASSPHRASE')?.value).toBe('x')
  })
})

describe('applySecretsAnswers / syncSchemaFromProvisionYaml', () => {
  test('writes values and syncs !env refs into schema', () => {
    const root = join(makeTempDir(), 'sec')
    temps.push(join(root, '..'))
    const provision = join(root, 'provision')
    mkdirSync(provision, { recursive: true })
    writeFileSync(join(provision, 'env-dev.yaml'), 'repo:\n  deploy_key: !env DEPLOY_KEY\n', 'utf8')
    writeFileSync(join(provision, '.env.schema'), '# ---\n', 'utf8')

    applySecretsAnswers(
      root,
      {
        valuesByEnv: {
          dev: { TANK_PASSPHRASE: 'lab', DEPLOY_KEY: 'varlock(prompt)' },
        },
        syncSchemaFromYaml: true,
      },
      [{ name: 'TANK_PASSPHRASE', encoding: 'utf8' }],
    )

    const schema = readFileSync(join(provision, '.env.schema'), 'utf8')
    expect(schema).toMatch(/TANK_PASSPHRASE=/)
    expect(schema).toMatch(/DEPLOY_KEY=/)

    const env = readFileSync(join(provision, '.env.dev'), 'utf8')
    expect(env).toContain('TANK_PASSPHRASE=lab')
    expect(env).toContain('DEPLOY_KEY=varlock(prompt)')
  })

  test('syncSchemaFromProvisionYaml alone', () => {
    const root = join(makeTempDir(), 'sec2')
    temps.push(join(root, '..'))
    const provision = join(root, 'provision')
    mkdirSync(provision, { recursive: true })
    writeFileSync(
      join(provision, 'common.yaml'),
      'ssh:\n  host_keys: !env { name: SSH_HOST_KEYS, encoding: base64 }\n',
      'utf8',
    )
    const { refs, added } = syncSchemaFromProvisionYaml(root)
    expect(refs).toContain('SSH_HOST_KEYS')
    expect(added).toContain('SSH_HOST_KEYS')
    expect(readFileSync(join(provision, '.env.schema'), 'utf8')).toMatch(/SSH_HOST_KEYS=/)
  })
})
