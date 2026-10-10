import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '../../../../shared/src/test-helpers.js'
import { initInstance } from '../../init.js'
import { loadEnvSecrets, loadEnvSecretsOrThrow } from './load-config.js'
import { resetRepoRootCache } from './paths.js'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

const origCwd = process.cwd()
const origEnv = { ...process.env }
/** @type {string[]} */
const temps = []

const SECRET_ENV = {
  VW_CLIENT_ID: 'client-id',
  VW_CLIENT_SECRET: 'client-secret',
  VW_MASTER_PASSWORD: 'master-pw',
  PROXMOX_API_TOKEN: 'root@pam!qctl=abc',
}

beforeEach(() => {
  resetRepoRootCache()
  Object.assign(process.env, SECRET_ENV)
})

afterEach(() => {
  process.chdir(origCwd)
  process.env = { ...origEnv }
  resetRepoRootCache()
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

/** @returns {string} real path of a fresh initialized instance */
function makeInstance() {
  const base = makeTempDir()
  temps.push(base)
  return realpathSync(initInstance(join(base, 'inst')).root)
}

describe('loadEnvSecrets (provision adapter)', () => {
  test('local target: resolves !env and keeps the seed/driver shape', async () => {
    const root = makeInstance()
    process.chdir(root)
    const sec = await loadEnvSecretsOrThrow({ env: 'dev', target: 'local' })

    expect(sec.env).toBe('dev')
    expect(sec.target).toBe('local')
    expect(sec.paths.map((p) => p.split('/').pop())).toEqual(['dev.yaml', 'dev.local.yaml'])
    expect(sec.provisionDir).toBe(join(root, 'provision'))
    expect(sec.guest).toMatchObject({
      TANK_PASSPHRASE: 'lab-tank-passphrase',
      ADMIN_USERNAME: 'rocky',
      DEPLOY_KEY: 'lab-deploy-key-placeholder',
    })
    expect(sec.ports.map((p) => p.name)).toEqual(['ssh', 'http', 'https'])
    expect(sec.ports[0]).toMatchObject({ name: 'ssh', port: 22, forward: 2222 })
    expect(sec.uplinks).toEqual([{ name: 'eth0', dhcp4: true }])
    expect(sec.vlans[0]).toMatchObject({ name: 'vlan2', id: 2, link: 'eth0', ipv4: '10.42.2.2' })
    expect(sec.local).toMatchObject({ cpu: 2, memory: 4096 })
    expect(sec.proxmox).toBeNull()
    expect(sec.networking).toBeTruthy()
  })

  test('qctl: key is stripped from data; platform preserved', async () => {
    process.chdir(makeInstance())
    const sec = await loadEnvSecretsOrThrow({ env: 'dev', target: 'local' })
    expect(sec.data.qctl).toBeUndefined()
    expect(sec.platform).toBe('rocky')
  })

  test('uses ssh.authorized_keys from provision YAML (string or list)', async () => {
    const root = makeInstance()
    process.chdir(root)
    const base = readFileSync(join(root, 'provision', 'dev.yaml'), 'utf8')
    writeFileSync(
      join(root, 'provision', 'dev.yaml'),
      `${base}\nssh:\n  authorized_keys:\n    - ssh-ed25519 AAAALIST list@test\n`,
    )
    const sec = await loadEnvSecretsOrThrow({ env: 'dev', target: 'local' })
    expect(sec.sshAuthorizedKeys).toBe('ssh-ed25519 AAAALIST list@test\n')

    writeFileSync(
      join(root, 'provision', 'dev.yaml'),
      `${base}\nssh:\n  authorized_keys: |\n    ssh-ed25519 AAAASTR string@test\n`,
    )
    const sec2 = await loadEnvSecretsOrThrow({ env: 'dev', target: 'local' })
    expect(sec2.sshAuthorizedKeys).toBe('ssh-ed25519 AAAASTR string@test\n')
  })

  test('falls back to ~/.ssh when ssh.authorized_keys empty/omitted', async () => {
    const root = makeInstance()
    process.chdir(root)

    const fakeHome = makeTempDir()
    temps.push(fakeHome)
    mkdirSync(join(fakeHome, '.ssh'), { recursive: true })
    const pub = join(fakeHome, '.ssh', 'id_ed25519.pub')
    writeFileSync(pub, 'ssh-ed25519 AAAAFALLBACK fallback@test\n')

    const prevHome = process.env.HOME
    process.env.HOME = fakeHome
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const sec = await loadEnvSecretsOrThrow({ env: 'dev', target: 'local' })
      expect(sec.sshAuthorizedKeys).toBe('ssh-ed25519 AAAAFALLBACK fallback@test\n')
      expect(warn.mock.calls.some((c) => String(c[0]).includes(pub))).toBe(true)
    } finally {
      process.env.HOME = prevHome
      warn.mockRestore()
    }
  })

  test('proxmox target merges overlay and drops local block', async () => {
    process.chdir(makeInstance())
    const sec = await loadEnvSecretsOrThrow({ env: 'dev', target: 'proxmox' })
    expect(sec.local).toBeNull()
    expect(sec.proxmox).toMatchObject({
      api_url: 'https://pve.example:8006',
      api_token: 'root@pam!qctl=abc',
      node: 'pve',
    })
    expect(sec.nets.length).toBeGreaterThan(0)
    expect(sec.vlans[0]?.ipv4).toBe('10.0.2.2')
  })

  test('unresolved !env throws a helpful error', async () => {
    process.chdir(makeInstance())
    delete process.env.PROXMOX_API_TOKEN
    await expect(loadEnvSecretsOrThrow({ env: 'dev', target: 'proxmox' })).rejects.toThrow(
      /PROXMOX_API_TOKEN/,
    )
  })

  test('missing @tag(guest) Tier-0 keys yield empty guest map', async () => {
    process.chdir(makeInstance())
    delete process.env.VW_CLIENT_ID
    delete process.env.VW_CLIENT_SECRET
    delete process.env.VW_MASTER_PASSWORD
    const sec = await loadEnvSecretsOrThrow({ env: 'dev', target: 'local' })
    expect(sec.guest.VW_CLIENT_ID).toBeUndefined()
  })

  test('missing env file throws', async () => {
    process.chdir(makeInstance())
    await expect(loadEnvSecretsOrThrow({ env: 'prod', target: 'local' })).rejects.toThrow(
      /provision file not found/,
    )
  })

  test('outside an instance throws a clear error', async () => {
    const dir = realpathSync(makeTempDir())
    temps.push(dir)
    process.chdir(dir)
    await expect(loadEnvSecretsOrThrow({ env: 'dev' })).rejects.toThrow(
      /not inside a qctl instance/,
    )
  })

  test('loadEnvSecrets exits 1 instead of throwing', async () => {
    const dir = realpathSync(makeTempDir())
    temps.push(dir)
    process.chdir(dir)
    const exit = spyOn(process, 'exit').mockImplementation((/** @type {number} */ c) => {
      throw new Error(`exit ${c}`)
    })
    const err = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(loadEnvSecrets({ env: 'dev' })).rejects.toThrow('exit 1')
    } finally {
      exit.mockRestore()
      err.mockRestore()
    }
  })
})
