import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  applyRepoRegAnswers,
  defaultRepoRegAnswers,
  registriesToPlain,
  repoToPlain,
  validateRegistryStaticLine,
} from './repo-reg.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('validateRegistryStaticLine', () => {
  test('accepts registry|user|token', () => {
    expect(validateRegistryStaticLine('ghcr.io|robot|tok')).toBeUndefined()
    expect(validateRegistryStaticLine('bad')).toMatch(/registry\|username\|token/)
  })
})

describe('repoToPlain / registriesToPlain', () => {
  test('markers for branch and deploy_key', () => {
    const plain = repoToPlain({
      vcs: 'git',
      url: 'ssh://git@example/org/repo',
      dir: '/tank/rocky',
      branch: { kind: 'omit' },
      deployKey: { kind: 'secret', name: 'DEPLOY_KEY', encoding: 'base64' },
    })
    expect(plain).toEqual({
      vcs: 'git',
      url: 'ssh://git@example/org/repo',
      dir: '/tank/rocky',
      deploy_key: '__DEPLOY_KEY__',
    })
  })

  test('registries markers for secrets', () => {
    expect(
      registriesToPlain([
        { kind: 'static', value: 'r|u|t' },
        { kind: 'secret', name: 'HEPTAPOD_REGISTRY', encoding: 'utf8' },
      ]),
    ).toEqual(['r|u|t', '__REG__1__'])
  })
})

describe('applyRepoRegAnswers', () => {
  test('writes repo + registry secret into env yaml', () => {
    const root = join(makeTempDir(), 'rr')
    temps.push(join(root, '..'))
    mkdirSync(join(root, 'provision'), { recursive: true })

    applyRepoRegAnswers(
      root,
      {
        shared: false,
        repo: {
          vcs: 'hg',
          url: 'ssh://hg@example/org/repo',
          dir: '/tank/rocky',
          branch: { kind: 'static', value: 'default' },
          deployKey: {
            kind: 'secret',
            name: 'DEPLOY_KEY',
            encoding: 'base64',
            value: 'YmFzZTY0',
          },
        },
        registries: [
          {
            kind: 'secret',
            name: 'HEPTAPOD_REGISTRY',
            encoding: 'utf8',
            value: 'registry.example|robot|tok',
          },
        ],
      },
      {
        profiles: { lab: { env: 'dev', target: 'workstation' } },
        environments: { dev: {} },
      },
    )

    const env = readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')
    expect(env).toContain('repo:')
    expect(env).toContain('vcs: hg')
    expect(env).toContain('branch: default')
    expect(env).toContain('!env { name: DEPLOY_KEY, encoding: base64 }')
    expect(env).toContain('registries:')
    expect(env).toContain('!env HEPTAPOD_REGISTRY')

    const schema = readFileSync(join(root, 'provision', '.env.schema'), 'utf8')
    expect(schema).toMatch(/DEPLOY_KEY/)
    expect(schema).toMatch(/HEPTAPOD_REGISTRY/)
  })

  test('defaults write nothing', () => {
    const root = join(makeTempDir(), 'rr2')
    temps.push(join(root, '..'))
    mkdirSync(join(root, 'provision'), { recursive: true })
    applyRepoRegAnswers(root, defaultRepoRegAnswers(false), {
      profiles: { lab: { env: 'dev', target: 'workstation' } },
      environments: { dev: {} },
    })
    expect(() => readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')).toThrow()
  })
})
