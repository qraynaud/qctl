import { join } from 'node:path'

import {
  collectEnvRefs,
  envRef,
  isEnvRef,
  loadHostEnv,
  loadHostGuestCredentials,
  loadProvision,
  parseProvisionYaml,
  provisionNeedsEnv,
  readEnvHostFile,
  resolveEnvRefs,
  stripOppositeTarget,
} from './provision.js'
import { makeTempDir, removeTempDir, writeFile, writeMinimalInstance } from './test-helpers.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { YamlMapping } from './yaml.js' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('parseProvisionYaml / !env', () => {
  test('parses !env scalars', () => {
    const doc = parseProvisionYaml(`
qctl:
  platform: rocky
vaultwarden:
  client_id: !env VW_CLIENT_ID
  nested:
    token: !env VW_TOKEN
`)
    expect(collectEnvRefs(doc)).toEqual(['VW_CLIENT_ID', 'VW_TOKEN'])
  })

  test('envRef helpers', () => {
    const ref = envRef('FOO')
    expect(isEnvRef(ref)).toBe(true)
    expect(isEnvRef({ name: 'FOO' })).toBe(false)
    expect(isEnvRef(null)).toBe(false)
  })

  test('empty document becomes {}', () => {
    expect(parseProvisionYaml('')).toEqual({})
  })

  test('invalid yaml throws with source', () => {
    expect(() => parseProvisionYaml('foo: [unclosed', 'bad.yaml')).toThrow(/bad\.yaml/)
  })
})

describe('resolveEnvRefs', () => {
  test('resolves from process env', () => {
    const doc = parseProvisionYaml(`a: !env FOO\nb: plain`)
    expect(resolveEnvRefs(doc, { FOO: 'secret' })).toEqual({ a: 'secret', b: 'plain' })
  })

  test('errors when missing; allows empty string', () => {
    const doc = parseProvisionYaml(`a: !env MISSING`)
    expect(() => resolveEnvRefs(doc, {})).toThrow(/MISSING/)
    expect(resolveEnvRefs(doc, { MISSING: '' })).toEqual({ a: '' })
  })

  test('resolves inside arrays', () => {
    const doc = parseProvisionYaml(`keys:\n  - !env K1\n  - plain`)
    expect(resolveEnvRefs(doc, { K1: 'v' })).toEqual({ keys: ['v', 'plain'] })
  })
})

describe('stripOppositeTarget', () => {
  test('drops proxmox on local target', () => {
    /** @type {YamlMapping} */
    const data = { local: { cpu: 2 }, proxmox: { node: 'pve' } }
    stripOppositeTarget(data, 'local')
    expect(data).toEqual({ local: { cpu: 2 } })
  })

  test('drops local on proxmox target', () => {
    /** @type {YamlMapping} */
    const data = { local: { cpu: 2 }, proxmox: { node: 'pve' } }
    stripOppositeTarget(data, 'proxmox')
    expect(data).toEqual({ proxmox: { node: 'pve' } })
  })
})

describe('loadProvision', () => {
  test('loads base + overlay, resolves !env', async () => {
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
    expect(data.vaultwarden).toEqual({ client_id: 'user.1' })
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
    expect(isEnvRef(/** @type {any} */ (data.proxmox).api_token)).toBe(true)
  })

  test('missing base file throws', async () => {
    const root = makeTempDir()
    temps.push(root)
    await expect(loadProvision({ root, env: 'dev' })).rejects.toThrow(/not found/)
  })

  test('provisionNeedsEnv', () => {
    const withRefs = writeMinimalInstance(makeTempDir(), { withEnvRefs: true })
    const plain = writeMinimalInstance(makeTempDir(), { withEnvRefs: false, withOverlay: false })
    temps.push(withRefs, plain)
    expect(provisionNeedsEnv(withRefs, 'dev', 'local')).toBe(true)
    expect(provisionNeedsEnv(plain, 'dev', 'local')).toBe(false)
  })

  test('resolves !env from .env.host when process env is empty', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeFile(
      root,
      '.env.host',
      [
        'VW_CLIENT_ID=user.from-host',
        'PROVISION_SSH_AUTHORIZED_KEYS="ssh-ed25519 AAAA comment"',
        'VW_CLIENT_SECRET=',
        '',
      ].join('\n'),
    )
    const { data } = await loadProvision({
      root,
      env: 'dev',
      target: 'local',
      processEnv: { PATH: '/usr/bin' },
    })
    expect(data.vaultwarden).toEqual({ client_id: 'user.from-host' })
  })

  test('.env.host.local overlays .env.host for !env resolution', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeFile(
      root,
      '.env.host',
      ['VW_CLIENT_ID=from-host', 'VW_CLIENT_SECRET=sec-host', ''].join('\n'),
    )
    writeFile(root, '.env.host.local', ['VW_CLIENT_ID=from-local', ''].join('\n'))
    const { data } = await loadProvision({
      root,
      env: 'dev',
      target: 'local',
      processEnv: { PATH: '/usr/bin' },
    })
    expect(data.vaultwarden).toEqual({ client_id: 'from-local' })
  })

  test('loadHostGuestCredentials returns @tag(guest) keys only', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeFile(
      root,
      '.env.host',
      ['# ---', '# @tag(guest)', 'VW_CLIENT_ID=guest-id', 'PROXMOX_API_TOKEN=host-only', ''].join(
        '\n',
      ),
    )
    const guest = await loadHostGuestCredentials(root, { PATH: '/usr/bin' })
    expect(guest).toEqual({ VW_CLIENT_ID: 'guest-id' })
    expect(guest.PROXMOX_API_TOKEN).toBeUndefined()
  })

  test('readEnvHostFile skips empties and expands quoted newlines', () => {
    const root = makeTempDir()
    temps.push(root)
    const f = join(root, '.env.host')
    writeFile(root, '.env.host', 'A=1\nB=\nC="x\\ny"\n')
    expect(readEnvHostFile(f)).toEqual({ A: '1', C: 'x\ny' })
  })

  test('varlock(prompt) is a known builtin (not Unknown resolver)', async () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(root, '.env.host', ['# ---', 'PROXMOX_API_TOKEN=varlock(prompt)', ''].join('\n'))
    // Force non-interactive: with a TTY, varlock(prompt) blocks on stdin forever.
    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    let err
    try {
      await loadHostEnv(root, { PATH: '/usr/bin', QCTL_ENV: 'dev' })
    } catch (e) {
      err = e
    } finally {
      if (stdinDesc) Object.defineProperty(process.stdin, 'isTTY', stdinDesc)
      else delete (/** @type {{ isTTY?: boolean }} */ (process.stdin).isTTY)
      if (stdoutDesc) Object.defineProperty(process.stdout, 'isTTY', stdoutDesc)
      else delete (/** @type {{ isTTY?: boolean }} */ (process.stdout).isTTY)
    }
    expect(err).toBeInstanceOf(Error)
    const msg = String(/** @type {Error} */ (err).message)
    expect(msg).not.toMatch(/Unknown resolver function/)
    expect(msg).toMatch(/encrypted value|prompt|TTY|varlock|Secret input/i)
  })
})
