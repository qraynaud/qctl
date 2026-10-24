import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { createTestContext } from './context.test-helpers.js'
import { runStage } from './run-stage.js'
import { describe, expect, test } from 'bun:test'

/** @import { StagePaths } from './context.js' */

describe('tier0-seal (JS, fake systemd-creds)', () => {
  /**
   * @param {{ seedPending: boolean }} o
   */
  function setup(o) {
    const dir = makeTempDir()
    const pending = join(dir, 'pending')
    const enc = join(dir, 'enc')
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    if (o.seedPending) {
      mkdirSync(pending)
      for (const n of ['VW_CLIENT_ID', 'VW_CLIENT_SECRET', 'VW_MASTER_PASSWORD']) {
        writeFileSync(join(pending, n), `secret-${n}\n`)
      }
    }
    const creds = join(bin, 'systemd-creds')
    writeFileSync(
      creds,
      '#!/bin/bash\nif [[ "$1" == encrypt ]]; then n=$#; cp "${@:$((n-1)):1}" "${@:$n:1}"; fi\nexit 0\n',
    )
    chmodSync(creds, 0o755)
    const shred = join(bin, 'shred')
    writeFileSync(shred, '#!/bin/bash\nrm -f "$2"\n')
    chmodSync(shred, 0o755)
    const env = { PATH: `${bin}:${process.env.PATH}` }
    const paths = { tier0Pending: pending, tier0Encrypted: enc }
    return { dir, pending, enc, env, paths }
  }

  /** @param {{ env: Record<string, string>, paths: StagePaths }} t */
  async function seal(t) {
    const ctx = createTestContext({
      spawnEnv: t.env,
      paths: t.paths,
      isRoot: () => true,
    })
    await runStage('tier0-seal', ctx)
  }

  test('seals pending → credstore, removes plaintext; re-run is a no-op', async () => {
    const t = setup({ seedPending: true })
    try {
      await seal(t)
      expect(readFileSync(join(t.enc, 'VW_CLIENT_ID'), 'utf8')).toBe('secret-VW_CLIENT_ID\n')
      expect(existsSync(t.pending)).toBe(false)
      await seal(t)
      expect(existsSync(join(t.enc, 'VW_MASTER_PASSWORD'))).toBe(true)
    } finally {
      removeTempDir(t.dir)
    }
  })

  test('nothing seeded at all → exit 0 (seed --allow-missing-tier0)', async () => {
    const t = setup({ seedPending: false })
    try {
      await seal(t)
      expect(existsSync(t.enc)).toBe(false)
    } finally {
      removeTempDir(t.dir)
    }
  })
})
