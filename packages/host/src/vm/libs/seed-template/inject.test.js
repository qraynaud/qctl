import {
  injectGuestCredentialFiles,
  injectPackagesManifest,
  injectProvisionFiles,
} from './inject.js'
import { describe, expect, test } from 'bun:test'

/** @import { YamlMapping } from '@qctl/shared' */

/**
 * @typedef {{
 *   path?: string,
 *   content?: string,
 *   encoding?: string,
 *   permissions?: string,
 * } & YamlMapping} WriteFile
 */

/**
 * @param {YamlMapping} userData
 * @returns {WriteFile[]}
 */
function writeFilesOf(userData) {
  return Array.isArray(userData.write_files)
    ? /** @type {WriteFile[]} */ (userData.write_files)
    : []
}

describe('injectGuestCredentialFiles', () => {
  test('embeds Tier-0 pending paths and replaces prior entries', () => {
    const userData = {
      write_files: [
        { path: '/var/lib/rocky/tier0-pending/TANK_PASSPHRASE', content: 'old\n' },
        { path: '/etc/other', content: 'keep\n' },
      ],
    }
    const out = injectGuestCredentialFiles(userData, {
      TANK_PASSPHRASE: 'new',
      OTHER: 'x',
    })
    const paths = writeFilesOf(out).map((w) => w.path)
    expect(paths).toContain('/etc/other')
    expect(paths).toContain('/var/lib/rocky/tier0-pending/TANK_PASSPHRASE')
    expect(paths).toContain('/var/lib/rocky/tier0-pending/OTHER')
    const tank = writeFilesOf(out).find(
      (w) => w.path === '/var/lib/rocky/tier0-pending/TANK_PASSPHRASE',
    )
    expect(tank?.content).toBe('new\n')
    expect(tank?.encoding).toBeUndefined()
  })

  test('base64-encodes utf8 credentials with C0/DEL so cloud-init YAML stays valid', () => {
    const binary = `gzip\u007f${String.fromCharCode(0x1f, 0x8b)}\n`
    const out = injectGuestCredentialFiles({ write_files: [] }, { SSH_HOST_KEYS: binary })
    const entry = writeFilesOf(out).find(
      (w) => w.path === '/var/lib/rocky/tier0-pending/SSH_HOST_KEYS',
    )
    expect(entry?.encoding).toBe('base64')
    expect(entry?.content).toBe(Buffer.from(binary, 'utf8').toString('base64'))
    expect(String(entry?.content)).not.toMatch(/\u007f/)
  })

  test('writes non-utf8 Buffer credentials as base64 text (utf8-hydrate safe)', () => {
    const raw = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff])
    const out = injectGuestCredentialFiles({ write_files: [] }, { SSH_HOST_KEYS: raw })
    const entry = writeFilesOf(out).find(
      (w) => w.path === '/var/lib/rocky/tier0-pending/SSH_HOST_KEYS',
    )
    expect(entry?.encoding).toBeUndefined()
    expect(entry?.content).toBe(`${raw.toString('base64')}\n`)
  })

  test('writes Buffer PEM as plain utf8 text', () => {
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n'
    const out = injectGuestCredentialFiles(
      { write_files: [] },
      { DEPLOY_KEY: Buffer.from(pem, 'utf8') },
    )
    const entry = writeFilesOf(out).find(
      (w) => w.path === '/var/lib/rocky/tier0-pending/DEPLOY_KEY',
    )
    expect(entry?.encoding).toBeUndefined()
    expect(entry?.content).toBe(pem.endsWith('\n') ? pem : `${pem}\n`)
  })
})

describe('injectPackagesManifest', () => {
  test('writes packages.json and replaces prior entry', () => {
    const userData = {
      write_files: [
        { path: '/usr/local/lib/rocky/packages.json', content: 'old\n' },
        { path: '/etc/other', content: 'keep\n' },
      ],
    }
    const out = injectPackagesManifest(userData, {
      distro: ['nano'],
      pipx: [],
      http: [],
    })
    const pkg = writeFilesOf(out).find((w) => w.path === '/usr/local/lib/rocky/packages.json')
    expect(JSON.parse(String(pkg?.content))).toEqual({
      distro: ['nano'],
      pipx: [],
      http: [],
    })
    expect(writeFilesOf(out).some((w) => w.path === '/etc/other')).toBe(true)
  })
})

describe('injectProvisionFiles', () => {
  test('merges files and ensures trailing newline', () => {
    const userData = {
      write_files: [{ path: '/etc/a', content: 'old\n' }],
    }
    const out = injectProvisionFiles(userData, [
      { path: '/etc/a', content: 'new' },
      { path: '/etc/b', content: 'b\n', owner: 'root:root', permissions: '0600' },
    ])
    const a = writeFilesOf(out).find((w) => w.path === '/etc/a')
    const b = writeFilesOf(out).find((w) => w.path === '/etc/b')
    expect(a?.content).toBe('new\n')
    expect(b?.content).toBe('b\n')
    expect(b?.permissions).toBe('0600')
  })
})
