import { mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from '../init.js'
import { diskMounts } from '../provision/schema/disks.js'
import {
  clearEnvProvisionCache,
  loadEnvProvision,
  loadEnvProvisionOrThrow,
  loadEnvProvisionSafe,
} from './load-config.js'
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
  clearEnvProvisionCache()
  Object.assign(process.env, SECRET_ENV)
})

afterEach(() => {
  process.chdir(origCwd)
  process.env = { ...origEnv }
  resetRepoRootCache()
  clearEnvProvisionCache()
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

describe('loadEnvProvision (provision adapter)', () => {
  test('workstation target: resolves !env and keeps the seed/driver shape', async () => {
    const root = makeInstance()
    process.chdir(root)
    const sec = await loadEnvProvisionOrThrow({ env: 'dev', target: 'workstation' })

    expect(sec.env).toBe('dev')
    expect(sec.target).toBe('workstation')
    expect(sec.paths.map((p) => p.split('/').pop())).toEqual([
      'common.yaml',
      'target-workstation.yaml',
      'env-dev.yaml',
      'profile-lab.yaml',
    ])
    expect(sec.provisionDir).toBe(join(root, 'provision'))
    expect(sec.guest).toMatchObject({
      tank_passphrase_tank: 'lab-tank-passphrase',
      ADMIN_USERNAME: 'admin',
      ADMIN_UID: '1000',
      ADMIN_GID: '1000',
    })
    expect(sec.guest.DEPLOY_KEY).toBeUndefined()
    expect(sec.guest.ADMIN_PASSWORD).toBeUndefined()
    expect(Object.keys(sec.ports).sort()).toEqual(['cockpit', 'http', 'https', 'ssh'])
    expect(sec.ports.ssh).toMatchObject({ port: 22, forward: 2222 })
    expect(sec.ports.cockpit).toMatchObject({ port: 9090, forward: 9090 })
    expect(sec.uplinks).toEqual({ eth0: { dhcp4: true } })
    expect(sec.vlans).toEqual({})
    expect(sec.data.disks?.data ?? {}).toEqual({})
    expect(sec.data.disks?.tanks?.tank?.vdevs?.data).toMatchObject({
      role: 'data',
      type: 'raidz',
    })
    expect(Object.keys(sec.data.disks?.tanks?.tank?.vdevs?.data?.members ?? {}).sort()).toEqual([
      'data1',
      'data2',
    ])
    expect(sec.workstation).toMatchObject({ cpu: 2, memory: 4096 })
    expect(sec.proxmox).toBeNull()
    expect(sec.networking).toBeTruthy()
  })

  test('qctl.platform defaults to rocky', async () => {
    process.chdir(makeInstance())
    const sec = await loadEnvProvisionOrThrow({ env: 'dev', target: 'workstation' })
    expect(sec.data.qctl.platform).toBe('rocky')
    expect(sec.platform).toBe('rocky')
  })

  test('uses ssh.authorized_keys from provision YAML (string or list)', async () => {
    const root = makeInstance()
    process.chdir(root)
    const base = readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')
    writeFileSync(
      join(root, 'provision', 'env-dev.yaml'),
      `${base}\nssh:\n  authorized_keys:\n    - ssh-ed25519 AAAALIST list@test\n`,
    )
    const sec = await loadEnvProvisionOrThrow({ env: 'dev', target: 'workstation' })
    expect(sec.sshAuthorizedKeys).toBe('ssh-ed25519 AAAALIST list@test\n')

    writeFileSync(
      join(root, 'provision', 'env-dev.yaml'),
      `${base}\nssh:\n  authorized_keys: |\n    ssh-ed25519 AAAASTR string@test\n`,
    )
    clearEnvProvisionCache()
    diskMounts.clear()
    const sec2 = await loadEnvProvisionOrThrow({ env: 'dev', target: 'workstation' })
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
      const sec = await loadEnvProvisionOrThrow({ env: 'dev', target: 'workstation' })
      expect(sec.sshAuthorizedKeys).toBe('ssh-ed25519 AAAAFALLBACK fallback@test\n')
      expect(warn.mock.calls.some((c) => String(c[0]).includes(pub))).toBe(true)
    } finally {
      process.env.HOME = prevHome
      warn.mockRestore()
    }
  })

  test('proxmox target merges overlay and drops workstation block', async () => {
    process.chdir(makeInstance())
    const sec = await loadEnvProvisionOrThrow({ env: 'dev', target: 'proxmox' })
    expect(sec.workstation).toBeNull()
    expect(sec.proxmox).toMatchObject({
      api_url: 'https://pve.example:8006',
      api_token: 'SET_PROXMOX_API_TOKEN',
      node: 'pve',
    })
    expect(sec.nets.length).toBeGreaterThan(0)
    expect(sec.vlans).toEqual({})
  })

  test('unresolved !env throws a helpful error', async () => {
    const root = makeInstance()
    process.chdir(root)
    writeFileSync(join(root, 'provision', '.env.schema'), 'MISSING_TOKEN=\n', 'utf8')
    writeFileSync(
      join(root, 'provision', 'target-proxmox.yaml'),
      `proxmox:
  api_url: https://pve.example:8006
  api_token: !env MISSING_TOKEN
  node: pve
  cpu: 2
  memory: 4096
  net:
    eth0:
      bridge: vmbr0
`,
      'utf8',
    )
    delete process.env.MISSING_TOKEN
    await expect(loadEnvProvisionOrThrow({ env: 'dev', target: 'proxmox' })).rejects.toThrow(
      /MISSING_TOKEN/,
    )
  })

  test('missing @tag(guest) Tier-0 keys yield empty guest map', async () => {
    process.chdir(makeInstance())
    delete process.env.VW_CLIENT_ID
    delete process.env.VW_CLIENT_SECRET
    delete process.env.VW_MASTER_PASSWORD
    const sec = await loadEnvProvisionOrThrow({ env: 'dev', target: 'workstation' })
    expect(sec.guest.VW_CLIENT_ID).toBeUndefined()
  })

  test('env with only common.yaml fails full provision schema', async () => {
    // Scaffold has common + dev overlays; prod has no env layer → common alone lacks networking.
    process.chdir(makeInstance())
    await expect(loadEnvProvisionOrThrow({ env: 'prod', target: 'workstation' })).rejects.toThrow(
      /networking/,
    )
  })

  test('missing all provision layers throws', async () => {
    const root = makeInstance()
    process.chdir(root)
    const provision = join(root, 'provision')
    for (const name of [
      'common.yaml',
      'env-dev.yaml',
      'target-workstation.yaml',
      'target-proxmox.yaml',
      'profile-lab.yaml',
    ]) {
      unlinkSync(join(provision, name))
    }
    // Keep a non-layer YAML so the tree still counts as an instance root.
    writeFileSync(join(provision, 'marker.yaml'), 'qctl:\n  platform: rocky\n')
    resetRepoRootCache()
    await expect(loadEnvProvisionOrThrow({ env: 'dev', target: 'workstation' })).rejects.toThrow(
      /no provision YAML found/,
    )
  })

  test('outside an instance throws a clear error', async () => {
    const dir = realpathSync(makeTempDir())
    temps.push(dir)
    process.chdir(dir)
    await expect(loadEnvProvisionOrThrow({ env: 'dev' })).rejects.toThrow(
      /not inside a qctl instance/,
    )
  })

  test('loadEnvProvision exits 1 instead of throwing', async () => {
    const dir = realpathSync(makeTempDir())
    temps.push(dir)
    process.chdir(dir)
    const exit = spyOn(process, 'exit').mockImplementation((/** @type {number} */ c) => {
      throw new Error(`exit ${c}`)
    })
    const err = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(loadEnvProvision({ env: 'dev' })).rejects.toThrow('exit 1')
    } finally {
      exit.mockRestore()
      err.mockRestore()
    }
  })

  test('loadEnvProvisionSafe caches same env+target and refuses a different key', async () => {
    process.chdir(makeInstance())
    const a = await loadEnvProvisionSafe({ env: 'dev', target: 'workstation' })
    const b = await loadEnvProvisionSafe({ env: 'dev', target: 'workstation' })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.provision).toBe(b.provision)

    await expect(loadEnvProvisionSafe({ env: 'dev', target: 'proxmox' })).rejects.toThrow(
      /already loaded/,
    )
  })

  test('loadEnvProvisionSafe returns error result without throwing', async () => {
    const dir = realpathSync(makeTempDir())
    temps.push(dir)
    process.chdir(dir)
    const r = await loadEnvProvisionSafe({ env: 'dev' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not inside a qctl instance/)
  })

  test('loadEnvProvisionSafe does not cache failures', async () => {
    const dir = realpathSync(makeTempDir())
    temps.push(dir)
    process.chdir(dir)
    const miss = await loadEnvProvisionSafe({ env: 'dev', target: 'workstation' })
    expect(miss.ok).toBe(false)
    process.chdir(makeInstance())
    resetRepoRootCache()
    const hit = await loadEnvProvisionSafe({ env: 'dev', target: 'workstation' })
    expect(hit.ok).toBe(true)
  })
})
