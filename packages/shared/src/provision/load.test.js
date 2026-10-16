import { makeTempDir, removeTempDir, writeFile, writeMinimalInstance } from '../test-helpers.js'
import { loadProvision, loadProvisionDocument, provisionNeedsEnv } from './load.js'
import { isEnvRef } from './yaml.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { ProvisionValue } from './yaml.js' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

/**
 * @param {string} root
 * @param {string} [devBody]
 */
function writeProvisionEnv(root, devBody = 'VW_CLIENT_ID=user.from-env\n') {
  writeFile(
    root,
    'provision/.env.schema',
    [
      '# ---',
      '# @sensitive',
      '# @optional',
      'VW_CLIENT_ID=',
      '# @sensitive',
      '# @optional',
      'VW_CLIENT_SECRET=',
      '# @sensitive',
      '# @optional',
      'PROVISION_SSH_AUTHORIZED_KEYS=',
      '# @sensitive',
      '# @optional',
      'PROXMOX_API_TOKEN=',
      '',
    ].join('\n'),
  )
  writeFile(root, 'provision/.env.dev', devBody)
}

describe('loadProvisionDocument', () => {
  test('loads env + local overlay and strips proxmox', () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    const doc = loadProvisionDocument({ root, env: 'dev', target: 'local' })
    expect(doc.commonPath).toBeNull()
    expect(doc.targetPath).toBeNull()
    expect(doc.envPath).toContain('dev.yaml')
    expect(doc.overlayPath).toContain('dev.local.yaml')
    expect(doc.envRefs).toContain('VW_CLIENT_ID')
    expect(doc.data.local).toEqual({ cpu: 2 })
    expect(doc.data.proxmox).toBeUndefined()
  })

  test('merges common → target → env → env.target', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(root, 'provision/common.yaml', 'local:\n  memory: 1024\n  cpu: 1\n')
    writeFile(root, 'provision/local.yaml', 'local:\n  memory: 2048\n')
    writeFile(root, 'provision/dev.yaml', 'local:\n  cpu: 4\n')
    writeFile(root, 'provision/dev.local.yaml', 'local:\n  memory: 8192\n')

    const doc = loadProvisionDocument({ root, env: 'dev', target: 'local' })
    expect(doc.commonPath).toContain('common.yaml')
    expect(doc.targetPath).toContain('local.yaml')
    expect(doc.envPath).toContain('dev.yaml')
    expect(doc.overlayPath).toContain('dev.local.yaml')
    // target before env: env cpu wins over common; overlay memory wins last
    expect(doc.data.local).toEqual({ cpu: 4, memory: 8192 })
  })

  test('target merges before env when both present', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(root, 'provision/local.yaml', 'local:\n  cpu: 2\n  memory: 2048\n')
    writeFile(root, 'provision/dev.yaml', 'local:\n  cpu: 8\n')

    const doc = loadProvisionDocument({ root, env: 'dev', target: 'local' })
    expect(doc.data.local).toEqual({ cpu: 8, memory: 2048 })
  })

  test('succeeds with only common.yaml', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(root, 'provision/common.yaml', 'qctl:\n  platform: rocky\n')
    const doc = loadProvisionDocument({ root, env: 'dev', target: 'local' })
    expect(doc.commonPath).toContain('common.yaml')
    expect(doc.envPath).toBeNull()
    expect(doc.data.qctl).toEqual({ platform: 'rocky' })
  })

  test('succeeds with only target.yaml', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(root, 'provision/local.yaml', 'local:\n  cpu: 2\n')
    const doc = loadProvisionDocument({ root, env: 'dev', target: 'local' })
    expect(doc.targetPath).toContain('local.yaml')
    expect(doc.data.local).toEqual({ cpu: 2 })
  })

  test('succeeds with only env.target overlay', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(root, 'provision/dev.local.yaml', 'local:\n  cpu: 2\n')
    const doc = loadProvisionDocument({ root, env: 'dev', target: 'local' })
    expect(doc.overlayPath).toContain('dev.local.yaml')
    expect(doc.data.local).toEqual({ cpu: 2 })
  })

  test('throws when no layer is present', () => {
    const root = makeTempDir()
    temps.push(root)
    expect(() => loadProvisionDocument({ root, env: 'dev', target: 'local' })).toThrow(
      /no provision YAML found/,
    )
  })

  test('throws when env is reserved name common', () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    expect(() => loadProvisionDocument({ root, env: 'common' })).toThrow(/reserved/)
  })

  test('throws when env is reserved target name', () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    expect(() => loadProvisionDocument({ root, env: 'local' })).toThrow(/reserved/)
    expect(() => loadProvisionDocument({ root, env: 'proxmox' })).toThrow(/reserved/)
  })

  test('throws when a present layer is not a mapping', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(root, 'provision/dev.yaml', '- just a list\n')
    expect(() => loadProvisionDocument({ root, env: 'dev' })).toThrow(/mapping/)
  })
})

describe('loadProvision', () => {
  test('loads base + overlay, resolves !env from process env', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)

    const { data, overlayPath, envRefs } = await loadProvision({
      root,
      env: 'dev',
      target: 'local',
      processEnv: { VW_CLIENT_ID: 'user.1' },
    })

    expect(overlayPath).toContain('dev.local.yaml')
    expect(envRefs).toContain('VW_CLIENT_ID')
    expect(data.vaultwarden).toEqual({ client_id: Buffer.from('user.1', 'utf8') })
    expect(data.local).toEqual({ cpu: 2 })
    expect(data.proxmox).toBeUndefined()
  })

  test('resolve:false keeps EnvRefs', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    const { data, envRefs } = await loadProvision({
      root,
      env: 'dev',
      target: 'proxmox',
      resolve: false,
    })
    expect(envRefs).toEqual(expect.arrayContaining(['VW_CLIENT_ID', 'PROXMOX_API_TOKEN']))
    const proxmox = /** @type {{ api_token: ProvisionValue }} */ (data.proxmox)
    expect(isEnvRef(proxmox.api_token)).toBe(true)
  })

  test('resolves !env from provision/.env.dev when process env is empty', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeProvisionEnv(
      root,
      [
        'VW_CLIENT_ID=user.from-env',
        'PROVISION_SSH_AUTHORIZED_KEYS="ssh-ed25519 AAAA comment"',
        'VW_CLIENT_SECRET=',
        '',
      ].join('\n'),
    )
    const { data } = await loadProvision({
      root,
      env: 'dev',
      target: 'local',
      processEnv: { PATH: '/usr/bin', QCTL_ENV: 'dev' },
    })
    expect(data.vaultwarden).toEqual({ client_id: Buffer.from('user.from-env', 'utf8') })
  })

  test('provision/.env.local overlays .env.dev for !env resolution', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeProvisionEnv(root, ['VW_CLIENT_ID=from-dev', 'VW_CLIENT_SECRET=sec-dev', ''].join('\n'))
    writeFile(root, 'provision/.env.local', ['VW_CLIENT_ID=from-local', ''].join('\n'))
    const { data } = await loadProvision({
      root,
      env: 'dev',
      target: 'local',
      processEnv: { PATH: '/usr/bin', QCTL_ENV: 'dev' },
    })
    expect(data.vaultwarden).toEqual({ client_id: Buffer.from('from-local', 'utf8') })
  })
})

describe('provisionNeedsEnv', () => {
  test('detects !env usage', () => {
    const withRefs = writeMinimalInstance(makeTempDir(), { withEnvRefs: true })
    const plain = writeMinimalInstance(makeTempDir(), { withEnvRefs: false, withOverlay: false })
    temps.push(withRefs, plain)
    expect(provisionNeedsEnv(withRefs, 'dev', 'local')).toBe(true)
    expect(provisionNeedsEnv(plain, 'dev', 'local')).toBe(false)
  })
})
