import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveProfile } from '@qctl/shared'
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  answersFromFlags,
  defaultQuickstartAnswers,
  formatQuickstartOutro,
  writeQuickstartLab,
} from './quickstart.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('quickstart', () => {
  test('answersFromFlags builds --yes lab preset', () => {
    const a = answersFromFlags(
      { name: 'ci-lab', tankPassphrase: 'secret:TANK_PASSPHRASE', cpu: 4, memory: 8192 },
      '/tmp/ci-lab',
    )
    expect(a.name).toBe('ci-lab')
    expect(a.sshAuthorizedKey).toBeNull()
    expect(a.repo).toBeNull()
    expect(a.tankPassphrase).toEqual({
      kind: 'secret',
      name: 'TANK_PASSPHRASE',
      encoding: 'utf8',
    })
    expect(a.cpu).toBe(4)
    expect(a.memory).toBe(8192)
  })

  test('outro mentions vm shell and new profile (not --force)', () => {
    const text = formatQuickstartOutro(defaultQuickstartAnswers('/tmp/x'))
    expect(text).toContain('qctl vm shell')
    expect(text).toContain('qctl new profile pve')
    expect(text).toContain('do not --force init')
    expect(text).not.toMatch(/init --force/)
  })

  test('outro leads with init-tank when tanks are not created yet', () => {
    const skipped = formatQuickstartOutro(defaultQuickstartAnswers('/tmp/x'), {
      needsInitTank: true,
    })
    expect(skipped).toMatch(/1\.\s+qctl vm init-tank/)
    expect(skipped).toMatch(/2\.\s+qctl vm up/)

    const done = formatQuickstartOutro(defaultQuickstartAnswers('/tmp/x'), {
      needsInitTank: false,
    })
    expect(done).toMatch(/1\.\s+qctl vm up/)
    expect(done).not.toContain('qctl vm init-tank')
  })

  test('writeQuickstartLab + static passphrase is resolvable', () => {
    const root = join(makeTempDir(), 'lab')
    temps.push(join(root, '..'))
    const answers = defaultQuickstartAnswers(root)
    answers.name = 'lab-demo'
    answers.cpu = 4
    answers.memory = 8192
    writeQuickstartLab(root, answers, { force: true })

    expect(resolveProfile({ root })).toMatchObject({
      key: 'lab',
      env: 'dev',
      target: 'workstation',
    })
    const overlay = readFileSync(join(root, 'provision', 'target-workstation.yaml'), 'utf8')
    expect(overlay).toContain('cpu: 4')
    expect(overlay).toContain('memory: 8192')
    const envYaml = readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')
    expect(envYaml).toContain('passphrase: lab-tank-passphrase')
    expect(envYaml).toContain('type: raidz')
    expect(envYaml).toContain('data1: { size: 2G }')
    expect(envYaml).toContain('data2: { size: 2G }')
    expect(envYaml).not.toMatch(/^ {2}data:/m)
    expect(envYaml).not.toMatch(/^\s+vlan2:/m)
    expect(envYaml).not.toMatch(/^repo:/m)
    const profileYaml = readFileSync(join(root, 'provision', 'profile-lab.yaml'), 'utf8')
    expect(profileYaml).not.toMatch(/^ {4}vlan2:/m)
    expect(profileYaml).not.toMatch(/^ {6}ipv4:/m)
  })

  test('omit tank passphrase drops encryption line', () => {
    const root = join(makeTempDir(), 'plain')
    temps.push(join(root, '..'))
    const answers = defaultQuickstartAnswers(root)
    answers.tankPassphrase = { kind: 'omit' }
    writeQuickstartLab(root, answers, { force: true })
    const envYaml = readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')
    expect(envYaml).toContain('tanks:')
    expect(envYaml).not.toMatch(/^\s*passphrase:/m)
  })

  test('writeQuickstartLab renders secret tank + ssh + repo via Nunjucks', () => {
    const root = join(makeTempDir(), 'sec')
    temps.push(join(root, '..'))
    const answers = defaultQuickstartAnswers(root)
    writeQuickstartLab(
      root,
      {
        ...answers,
        sshAuthorizedKey: 'ssh-ed25519 AAAATEST user@host',
        tankPassphrase: {
          kind: 'secret',
          name: 'TANK_PASSPHRASE',
          encoding: 'utf8',
          value: 's3cret',
        },
        repo: {
          vcs: 'git',
          url: 'ssh://git@example/repo.git',
          dir: '/tank/app',
          deployKey: {
            kind: 'secret',
            name: 'DEPLOY_KEY',
            encoding: 'base64',
            value: 'YWJj',
          },
        },
      },
      { force: true },
    )

    const envYaml = readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')
    expect(envYaml).toContain('passphrase: !env TANK_PASSPHRASE')
    expect(envYaml).toContain('ssh-ed25519 AAAATEST')
    expect(envYaml).toContain('deploy_key: !env { name: DEPLOY_KEY, encoding: base64 }')
    const schema = readFileSync(join(root, 'provision', '.env.schema'), 'utf8')
    expect(schema).toContain('TANK_PASSPHRASE=')
    expect(schema).toContain('DEPLOY_KEY=')
    const envFile = readFileSync(join(root, 'provision', '.env.dev'), 'utf8')
    expect(envFile).toContain('TANK_PASSPHRASE=s3cret')
    expect(envFile).toContain('DEPLOY_KEY=YWJj')
  })
})
