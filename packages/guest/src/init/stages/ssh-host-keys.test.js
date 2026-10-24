import { createTestContext } from '../context.test-helpers.js'
import { StageError } from '../errors.js'
import sshHostKeys from './ssh-host-keys.js'
import { describe, expect, test } from 'bun:test'

describe('ssh-host-keys stage', () => {
  test('exports name and plan', () => {
    expect(sshHostKeys.name).toBe('ssh-host-keys')
    const ctx = createTestContext({ log: () => {} })
    expect(sshHostKeys.plan(ctx).join('\n')).toMatch(/SSH_HOST_KEYS/)
  })

  test('run requires root', async () => {
    const ctx = createTestContext({
      log: () => {},
      isRoot: () => false,
    })
    await expect(sshHostKeys.run(ctx)).rejects.toBeInstanceOf(StageError)
  })
})
