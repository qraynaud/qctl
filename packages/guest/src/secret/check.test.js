import { removeTempDir } from '../../../shared/src/test-helpers.js'
import { runSecretCheck } from './check.js'
import { makeSecretInstance } from './fixture.js'
import { SECRET_HASH_LABEL, secretContentHash } from './hash.js'
import { syncAll } from './sync.js'
import { describe, expect, test } from 'bun:test'

/** @import { PodmanRunner } from './sync.js' */

/**
 * @returns {{ podman: PodmanRunner, hashes: Record<string, string>, existing: Set<string> }}
 */
function storePodman() {
  /** @type {Record<string, string>} */
  const hashes = {}
  /** @type {Set<string>} */
  const existing = new Set()
  return {
    hashes,
    existing,
    podman: {
      run(engine, args, opts) {
        if (args[1] === 'exists') {
          return { status: existing.has(`${engine}/${args[2]}`) ? 0 : 1, stdout: '' }
        }
        if (args[1] === 'inspect') {
          const key = `${engine}/${args[2]}`
          if (!existing.has(key)) return { status: 1, stdout: '' }
          return { status: 0, stdout: `${hashes[key] ?? ''}\n` }
        }
        if (args[1] === 'rm') {
          existing.delete(`${engine}/${args[2]}`)
          delete hashes[`${engine}/${args[2]}`]
          return { status: 0, stdout: '' }
        }
        if (args[1] === 'create') {
          let label = ''
          let name = ''
          for (let i = 2; i < args.length; i++) {
            if (args[i] === '--label') {
              label = args[++i] ?? ''
              continue
            }
            if (args[i] !== '-') name = args[i]
          }
          const key = `${engine}/${name}`
          existing.add(key)
          const m = label.match(new RegExp(`^${SECRET_HASH_LABEL}=(.+)$`))
          hashes[key] = m?.[1] ?? ''
          void opts
          return { status: 0, stdout: '' }
        }
        return { status: 0, stdout: '' }
      },
    },
  }
}

describe('runSecretCheck', () => {
  test('missing secrets → drift', async () => {
    const root = makeSecretInstance()
    const store = storePodman()
    try {
      const r = await runSecretCheck({
        root,
        uid: 1000,
        env: {},
        podman: store.podman,
        log: () => {},
      })
      expect(r.ok).toBe(false)
      expect(r.rows.find((x) => x.name === 'CADDY_DNS')?.status).toBe('missing')
    } finally {
      removeTempDir(root)
    }
  })

  test('after sync → match', async () => {
    const root = makeSecretInstance()
    const store = storePodman()
    try {
      await syncAll({ root, uid: 1000, env: {}, podman: store.podman, log: () => {} })
      const r = await runSecretCheck({
        root,
        uid: 1000,
        env: {},
        podman: store.podman,
        log: () => {},
      })
      expect(r.ok).toBe(true)
      expect(r.rows.find((x) => x.name === 'CADDY_DNS')?.status).toBe('match')
      expect(store.hashes['rootless/CADDY_DNS']).toBe(secretContentHash('real-dns-token'))
    } finally {
      removeTempDir(root)
    }
  })

  test('wrong hash → mismatch', async () => {
    const root = makeSecretInstance()
    const store = storePodman()
    try {
      store.existing.add('rootless/CADDY_DNS')
      store.hashes['rootless/CADDY_DNS'] = 'deadbeef'
      const r = await runSecretCheck({
        root,
        uid: 1000,
        env: {},
        podman: store.podman,
        log: () => {},
      })
      expect(r.ok).toBe(false)
      expect(r.rows.find((x) => x.name === 'CADDY_DNS')?.status).toBe('mismatch')
    } finally {
      removeTempDir(root)
    }
  })
})
