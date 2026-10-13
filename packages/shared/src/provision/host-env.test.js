import { join } from 'node:path'

import { makeTempDir, removeTempDir, writeFile, writeMinimalInstance } from '../test-helpers.js'
import * as varlock from '../varlock/index.js'
import {
  PROVISION_DIR,
  loadHostEnv,
  loadHostEnvDetailed,
  loadHostGuestCredentials,
  provisionEnvDir,
} from './host-env.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

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
      'PROXMOX_API_TOKEN=',
      '',
    ].join('\n'),
  )
  writeFile(root, 'provision/.env.dev', devBody)
}

describe('provisionEnvDir', () => {
  test('returns null without provision/.env.schema', () => {
    const root = makeTempDir()
    temps.push(root)
    expect(provisionEnvDir(root)).toBeNull()
  })

  test('returns absolute provision dir when schema exists', () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeProvisionEnv(root)
    expect(provisionEnvDir(root)).toBe(join(root, PROVISION_DIR))
  })
})

describe('loadHostEnvDetailed', () => {
  test('without schema returns process env only', async () => {
    const root = makeTempDir()
    temps.push(root)
    const { env, guest } = await loadHostEnvDetailed(root, {
      PATH: '/usr/bin',
      EMPTY: '',
      KEEP: 'x',
    })
    expect(env).toEqual({ PATH: '/usr/bin', KEEP: 'x' })
    expect(guest).toEqual({})
  })

  test('loads provision/.env.dev and merges non-empty process env', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeProvisionEnv(root, 'VW_CLIENT_ID=from-file\n')
    const { env } = await loadHostEnvDetailed(root, {
      PATH: '/usr/bin',
      QCTL_ENV: 'dev',
      VW_CLIENT_ID: 'from-process',
    })
    expect(env.VW_CLIENT_ID).toBe('from-process')
    expect(env.PATH).toBe('/usr/bin')
  })

  test('ensures package deps before loading the graph', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeProvisionEnv(root, 'VW_CLIENT_ID=from-file\n')
    const ensure = spyOn(varlock, 'ensurePackageDependencies').mockResolvedValue({
      root,
      installed: false,
      frozen: false,
    })
    try {
      await loadHostEnv(root, { PATH: '/usr/bin', QCTL_ENV: 'dev' })
      expect(ensure).toHaveBeenCalled()
      expect(ensure.mock.calls[0]?.[0]).toBe(join(root, PROVISION_DIR))
    } finally {
      ensure.mockRestore()
    }
  })

  test('surfaces plugin ensure failures', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeProvisionEnv(root, 'VW_CLIENT_ID=from-file\n')
    const ensure = spyOn(varlock, 'ensurePackageDependencies').mockRejectedValue(
      new Error('no package.json'),
    )
    try {
      await expect(loadHostEnv(root, { PATH: '/usr/bin', QCTL_ENV: 'dev' })).rejects.toThrow(
        /varlock plugin ensure failed for provision\/\.env/,
      )
    } finally {
      ensure.mockRestore()
    }
  })

  test('loadHostEnv returns the env map', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeProvisionEnv(root, 'VW_CLIENT_ID=from-file\n')
    const env = await loadHostEnv(root, { PATH: '/usr/bin', QCTL_ENV: 'dev' })
    expect(env.VW_CLIENT_ID).toBe('from-file')
  })

  test('.env.local overlays .env.dev', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeProvisionEnv(root, 'VW_CLIENT_ID=from-dev\n')
    writeFile(root, 'provision/.env.local', 'VW_CLIENT_ID=from-local\n')
    const env = await loadHostEnv(root, { PATH: '/usr/bin', QCTL_ENV: 'dev' })
    expect(env.VW_CLIENT_ID).toBe('from-local')
  })

  test('loadHostGuestCredentials returns @tag(guest) keys only', async () => {
    const root = writeMinimalInstance(makeTempDir())
    temps.push(root)
    writeFile(
      root,
      'provision/.env.schema',
      [
        '# ---',
        '# @tag(guest)',
        '# @sensitive',
        'VW_CLIENT_ID=',
        '# @sensitive',
        '# @optional',
        'PROXMOX_API_TOKEN=',
        '',
      ].join('\n'),
    )
    writeFile(
      root,
      'provision/.env.dev',
      ['VW_CLIENT_ID=guest-id', 'PROXMOX_API_TOKEN=host-only', ''].join('\n'),
    )
    const guest = await loadHostGuestCredentials(root, { PATH: '/usr/bin', QCTL_ENV: 'dev' })
    expect(guest).toEqual({ VW_CLIENT_ID: 'guest-id' })
    expect(guest.PROXMOX_API_TOKEN).toBeUndefined()
  })

  test('varlock(prompt) is a known builtin (not Unknown resolver)', async () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      'provision/.env.schema',
      ['# ---', '# @sensitive', '# @optional', 'PROXMOX_API_TOKEN=', ''].join('\n'),
    )
    writeFile(root, 'provision/.env.dev', ['PROXMOX_API_TOKEN=varlock(prompt)', ''].join('\n'))
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
