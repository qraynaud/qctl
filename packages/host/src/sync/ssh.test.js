import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { sshAuthFromIdentity, sshInteractiveShell } from './ssh.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []
const prevSock = process.env.SSH_AUTH_SOCK

afterEach(() => {
  if (prevSock === undefined) delete process.env.SSH_AUTH_SOCK
  else process.env.SSH_AUTH_SOCK = prevSock
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('sshAuthFromIdentity', () => {
  test('loads an unencrypted identity file', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const key = join(dir, 'id_test')
    writeFileSync(
      key,
      '-----BEGIN OPENSSH PRIVATE KEY-----\nplain\n-----END OPENSSH PRIVATE KEY-----\n',
    )
    delete process.env.SSH_AUTH_SOCK
    const auth = sshAuthFromIdentity(key)
    expect(Buffer.isBuffer(auth.privateKey)).toBe(true)
  })

  test('rejects encrypted keys without an agent', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const key = join(dir, 'id_enc')
    writeFileSync(
      key,
      '-----BEGIN OPENSSH PRIVATE KEY-----\nENCRYPTED\n-----END OPENSSH PRIVATE KEY-----\n',
    )
    delete process.env.SSH_AUTH_SOCK
    expect(() => sshAuthFromIdentity(key)).toThrow(/encrypted/)
  })
})

describe('sshInteractiveShell', () => {
  test('requires a TTY', async () => {
    await expect(
      sshInteractiveShell({ host: '127.0.0.1', port: 22, username: 'rocky' }),
    ).rejects.toThrow(/TTY/)
  })
})
