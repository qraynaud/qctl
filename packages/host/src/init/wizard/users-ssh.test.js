import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  applyUsersSshAnswers,
  defaultUsersSshAnswers,
  resolveAuthorizedKeyInput,
  sshToPlain,
  usersToPlain,
} from './users-ssh.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('resolveAuthorizedKeyInput', () => {
  test('splits multiline paste', () => {
    expect(
      resolveAuthorizedKeyInput('ssh-ed25519 AAAAa a@h\n# comment\nssh-ed25519 AAAAb b@h\n'),
    ).toEqual(['ssh-ed25519 AAAAa a@h', 'ssh-ed25519 AAAAb b@h'])
  })

  test('reads .pub file path', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const path = join(dir, 'id_ed25519.pub')
    writeFileSync(path, 'ssh-ed25519 AAAAfile user@host\n', 'utf8')
    expect(resolveAuthorizedKeyInput(path)).toEqual(['ssh-ed25519 AAAAfile user@host'])
  })
})

describe('usersToPlain / sshToPlain', () => {
  test('password secret uses marker; omit password key when omit', () => {
    const plain = usersToPlain({
      admin: {
        username: 'admin',
        uid: 1000,
        password: { kind: 'secret', name: 'ADMIN_PASSWORD', encoding: 'utf8' },
      },
      apps: { username: 'apps', uid: 900, subuid: '900000:32768' },
    })
    expect(plain.admin).toMatchObject({
      username: 'admin',
      password: '__ADMIN_PASSWORD__',
    })
    expect(plain.apps).toMatchObject({ subuid: '900000:32768' })

    const omitPw = usersToPlain({
      admin: { username: 'admin', password: { kind: 'omit' } },
      apps: { username: 'apps' },
    })
    expect(omitPw.admin).not.toHaveProperty('password')
  })

  test('sshToPlain null when empty', () => {
    expect(sshToPlain(defaultUsersSshAnswers())).toBeNull()
    expect(
      sshToPlain({
        shared: false,
        users: null,
        authorizedKeys: ['ssh-ed25519 AAA a@h'],
        hostKeys: { kind: 'omit' },
      }),
    ).toEqual({ authorized_keys: 'ssh-ed25519 AAA a@h' })
  })
})

describe('applyUsersSshAnswers', () => {
  test('writes users+ssh to env file and injects secrets', () => {
    const root = join(makeTempDir(), 'uss')
    temps.push(join(root, '..'))
    mkdirSync(join(root, 'provision'), { recursive: true })

    applyUsersSshAnswers(
      root,
      {
        shared: false,
        users: {
          admin: {
            username: 'ops',
            uid: 1000,
            password: {
              kind: 'secret',
              name: 'ADMIN_PASSWORD',
              encoding: 'utf8',
              value: 's3cret',
            },
          },
          apps: { username: 'apps', uid: 900 },
        },
        authorizedKeys: ['ssh-ed25519 AAAATEST user@host'],
        hostKeys: {
          kind: 'secret',
          name: 'SSH_HOST_KEYS',
          encoding: 'base64',
        },
      },
      {
        profiles: { lab: { env: 'dev', target: 'workstation' } },
        environments: { dev: {} },
      },
    )

    const env = readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')
    expect(env).toContain('users:')
    expect(env).toContain('username: ops')
    expect(env).toContain('!env ADMIN_PASSWORD')
    expect(env).toContain('authorized_keys: ssh-ed25519 AAAATEST user@host')
    expect(env).toContain('!env { name: SSH_HOST_KEYS, encoding: base64 }')

    const schema = readFileSync(join(root, 'provision', '.env.schema'), 'utf8')
    expect(schema).toMatch(/ADMIN_PASSWORD/)
    expect(schema).toMatch(/SSH_HOST_KEYS/)
    const envFile = readFileSync(join(root, 'provision', '.env.dev'), 'utf8')
    expect(envFile).toContain('ADMIN_PASSWORD=s3cret')
  })

  test('shared → common.yaml; defaults omit writes nothing', () => {
    const root = join(makeTempDir(), 'uss2')
    temps.push(join(root, '..'))
    mkdirSync(join(root, 'provision'), { recursive: true })
    writeFileSync(join(root, 'provision', 'common.yaml'), 'qctl:\n  platform: rocky\n', 'utf8')

    applyUsersSshAnswers(root, defaultUsersSshAnswers(true), {
      profiles: { lab: { env: 'dev', target: 'workstation' } },
      environments: { dev: {} },
    })
    const common = readFileSync(join(root, 'provision', 'common.yaml'), 'utf8')
    expect(common).not.toContain('users:')
    expect(common).not.toContain('ssh:')
  })
})
