import { join } from 'node:path'

import { removeTempDir } from '@qctl/shared/test-helpers'

import { makeSecretInstance } from '../../secret/fixture.js'
import { createSecretOps, invokeSecretOp } from './ops.js'
import { describe, expect, test } from 'bun:test'

describe('secret ops', () => {
  test('sync scoped + check exit codes; errors become exitCode 1', async () => {
    const root = makeSecretInstance()
    try {
      /** @type {string[]} */
      const lines = []
      const ops = createSecretOps({
        root,
        rootlessOnly: false,
        log: (m) => lines.push(m),
      })
      // Inject fake podman via sync would need opts — use dryRun path through syncAll
      // by calling check which uses defaultPodman (may skip). Prefer invoke with dry sync.
      const dry = await invokeSecretOp(ops, { op: 'sync', app: 'caddy', dryRun: true })
      expect(dry.exitCode).toBe(0)

      const missing = await invokeSecretOp(
        createSecretOps({ root: join(root, 'nope'), log: () => {} }),
        {
          op: 'sync',
        },
      )
      expect(missing.exitCode).toBe(1)
      expect(missing.error).toMatch(/no /)
    } finally {
      removeTempDir(root)
    }
  })
})
