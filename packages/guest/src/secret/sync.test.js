import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir, writeFile } from '@qctl/shared/test-helpers'

import {
  discoverSecretConsumers,
  secretNamesConsumedByApp,
  secretNamesInContainer,
} from './consumers.js'
import { makeSecretInstance, makeShims } from './fixture.js'
import { SECRET_HASH_LABEL, secretContentHash } from './hash.js'
import {
  discoverSchemaDirs,
  podmanSecretName,
  schemaDirIsRootful,
  schemaDirsForSync,
  syncAll,
} from './sync.js'
import { loadSensitiveItems } from './varlock.js'
import { describe, expect, test } from 'bun:test'

/** @import { Engine, PodmanRunner } from './sync.js' */

/**
 * @param {Engine[]} [unavailable]
 * @returns {{
 *   podman: PodmanRunner,
 *   calls: string[],
 *   created: Record<string, string>,
 *   hashes: Record<string, string>,
 * }}
 */
function recordingPodman(unavailable = []) {
  /** @type {string[]} */
  const calls = []
  /** @type {Record<string, string>} */
  const created = {}
  /** @type {Record<string, string>} */
  const hashes = {}
  /** @type {Set<string>} */
  const existing = new Set()
  return {
    calls,
    created,
    hashes,
    podman: {
      run(engine, args, opts) {
        if (unavailable.includes(engine)) return null
        calls.push(`${engine}: ${args.join(' ')}`)
        if (args[0] === 'secret' && args[1] === 'exists') {
          const name = args[2]
          return { status: existing.has(`${engine}/${name}`) ? 0 : 1, stdout: '' }
        }
        if (args[0] === 'secret' && args[1] === 'inspect') {
          const name = args[2]
          const key = `${engine}/${name}`
          if (!existing.has(key)) return { status: 1, stdout: '' }
          return { status: 0, stdout: `${hashes[key] ?? ''}\n` }
        }
        if (args[0] === 'secret' && args[1] === 'rm') {
          const name = args[2]
          existing.delete(`${engine}/${name}`)
          delete created[`${engine}/${name}`]
          delete hashes[`${engine}/${name}`]
          return { status: 0, stdout: '' }
        }
        if (args[0] === 'secret' && args[1] === 'create') {
          // secret create [--label k=v] name -
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
          created[key] = opts?.input ?? ''
          const m = label.match(new RegExp(`^${SECRET_HASH_LABEL}=(.+)$`))
          hashes[key] = m?.[1] ?? ''
          return { status: 0, stdout: '' }
        }
        return { status: 0, stdout: '' }
      },
    },
  }
}

describe('naming + discovery', () => {
  test('podmanSecretName: schema key as-is', () => {
    expect(podmanSecretName('CADDY_DNS')).toBe('CADDY_DNS')
    expect(podmanSecretName('ACTIVE_DIRECTORY_ADMIN_PASSWORD')).toBe(
      'ACTIVE_DIRECTORY_ADMIN_PASSWORD',
    )
  })

  test('discoverSchemaDirs: unit dirs + common/<lib> with .env.schema; package-root template ignored; sorted', () => {
    const root = makeSecretInstance()
    try {
      writeFile(root, 'common/pg/.env.schema', '\n')
      writeFile(root, 'common/nope/readme', '\n')
      writeFile(root, 'applications/caddy/.env.schema', '# template only\n')
      writeFile(root, 'applications/caddy/extra/readme', '\n')
      const rel = discoverSchemaDirs(root).map((d) => d.slice(root.length + 1))
      expect(rel).toEqual(['applications/ad/ad', 'applications/caddy/caddy', 'common/pg'])
    } finally {
      removeTempDir(root)
    }
  })

  test('shims fixture is usable (smoke)', () => {
    const s = makeShims()
    try {
      expect(existsSync(join(s.dir, 'podman'))).toBe(true)
    } finally {
      removeTempDir(s.dir)
    }
  })

  test('secretNamesInContainer + discoverSecretConsumers + secretNamesConsumedByApp', () => {
    const root = makeTempDir()
    try {
      writeFile(
        root,
        'applications/caddy/caddy/caddy.container',
        '[Container]\nSecret=CADDY_DNS,type=env,target=X\nSecret=PG_PASS,type=env,target=P\n',
      )
      writeFile(root, 'applications/caddy/app.yaml', 'engine: rootless\n')
      expect(
        secretNamesInContainer(join(root, 'applications/caddy/caddy/caddy.container')),
      ).toEqual(['CADDY_DNS', 'PG_PASS'])
      const map = discoverSecretConsumers(root)
      expect([...(map.get('CADDY_DNS') ?? [])]).toEqual(['caddy'])
      expect([...secretNamesConsumedByApp(root, 'caddy')].sort()).toEqual(['CADDY_DNS', 'PG_PASS'])
      expect(secretNamesConsumedByApp(root, 'missing').size).toBe(0)
    } finally {
      removeTempDir(root)
    }
  })

  test('schemaDirsForSync scopes to app units + common', () => {
    const root = makeSecretInstance()
    try {
      writeFile(root, 'common/pg/.env.schema', '# ---\n# @sensitive\nPG_PASS=x\n')
      const caddy = schemaDirsForSync(root, 'caddy').map((d) => d.slice(root.length + 1))
      expect(caddy).toEqual(['applications/caddy/caddy', 'common/pg'])
      expect(schemaDirsForSync(root, 'ad').map((d) => d.slice(root.length + 1))).toEqual([
        'applications/ad/ad',
        'common/pg',
      ])
    } finally {
      removeTempDir(root)
    }
  })

  test('syncAll app= only that app; common only if Secret=; rootlessOnly skips rootful', async () => {
    const root = makeSecretInstance()
    try {
      writeFile(
        root,
        'common/pg/.env.schema',
        '# ---\n# @sensitive @required\nPG_PASS=pg-secret-value\n# @sensitive @required\nOTHER=unused-secret-value\n',
      )
      writeFile(
        root,
        'applications/caddy/caddy/caddy.container',
        '[Container]\nImage=x\nSecret=PG_PASS,type=env,target=P\n',
      )
      const rec = recordingPodman()
      const r = await syncAll({
        root,
        app: 'caddy',
        uid: 0,
        env: {},
        podman: rec.podman,
        log: () => {},
      })
      expect(Object.keys(rec.created).sort()).toEqual(['rootless/CADDY_DNS', 'rootless/PG_PASS'])
      expect(rec.created['rootless/OTHER']).toBeUndefined()
      expect(r.synced).toBe(2)

      const ad = recordingPodman()
      await syncAll({
        root,
        app: 'ad',
        rootlessOnly: true,
        uid: 0,
        env: {},
        podman: ad.podman,
        log: () => {},
      })
      expect(Object.keys(ad.created)).toEqual([])
    } finally {
      removeTempDir(root)
    }
  })
})

describe('varlock graph discovery', () => {
  test('schemaDirIsRootful follows app.yaml engine:; plain keys skipped from sync list', async () => {
    const root = makeSecretInstance()
    try {
      const ad = join(root, 'applications/ad/ad')
      const caddy = join(root, 'applications/caddy/caddy')
      expect(schemaDirIsRootful(root, ad)).toBe(true)
      expect(schemaDirIsRootful(root, caddy)).toBe(false)
      expect(
        await loadSensitiveItems(ad, { env: {}, rootful: schemaDirIsRootful(root, ad) }),
      ).toEqual([
        {
          key: 'ACTIVE_DIRECTORY_ADMIN_PASSWORD',
          value: 'real-ad-pass',
          engines: ['rootful'],
        },
      ])
      expect(
        await loadSensitiveItems(caddy, { env: {}, rootful: schemaDirIsRootful(root, caddy) }),
      ).toEqual([{ key: 'CADDY_DNS', value: 'real-dns-token', engines: ['rootless'] }])
    } finally {
      removeTempDir(root)
    }
  })

  test('@tag(cross-engine) targets both stores', async () => {
    const root = makeSecretInstance()
    try {
      writeFile(
        root,
        'applications/caddy/caddy/.env.schema',
        '# ---\n# @sensitive @required @tag(cross-engine)\nSHARED_TOKEN=shared-value\n',
      )
      const dir = join(root, 'applications/caddy/caddy')
      expect(
        await loadSensitiveItems(dir, { env: {}, rootful: schemaDirIsRootful(root, dir) }),
      ).toEqual([{ key: 'SHARED_TOKEN', value: 'shared-value', engines: ['rootless', 'rootful'] }])

      const rec = recordingPodman()
      const r = await syncAll({
        root,
        uid: 0,
        env: {},
        podman: rec.podman,
        log: () => {},
      })
      expect(r.synced).toBeGreaterThanOrEqual(2)
      expect(rec.created['rootless/SHARED_TOKEN']).toBe('shared-value')
      expect(rec.created['rootful/SHARED_TOKEN']).toBe('shared-value')
    } finally {
      removeTempDir(root)
    }
  })

  test('QCTL_ENV selects .env.<env> via currentEnvFallback', async () => {
    const root = makeSecretInstance()
    try {
      writeFile(
        root,
        'applications/caddy/caddy/.env.schema',
        '# ---\n# @sensitive @required\nCADDY_DNS=\n',
      )
      writeFile(root, 'applications/caddy/caddy/.env.dev', 'CADDY_DNS=from-dev\n')
      writeFile(root, 'applications/caddy/caddy/.env.prod', 'CADDY_DNS=from-prod\n')
      const dir = join(root, 'applications/caddy/caddy')
      expect(await loadSensitiveItems(dir, { qctlEnv: 'dev' })).toEqual([
        { key: 'CADDY_DNS', value: 'from-dev', engines: ['rootless'] },
      ])
      expect(await loadSensitiveItems(dir, { qctlEnv: 'prod' })).toEqual([
        { key: 'CADDY_DNS', value: 'from-prod', engines: ['rootless'] },
      ])
    } finally {
      removeTempDir(root)
    }
  })

  test('unknown vw() throws', async () => {
    const root = makeSecretInstance()
    try {
      writeFile(
        root,
        'applications/caddy/caddy/.env.schema',
        '# ---\n# @sensitive\nCADDY_DNS=vw("nope")\n',
      )
      await expect(
        loadSensitiveItems(join(root, 'applications/caddy/caddy'), { env: {} }),
      ).rejects.toThrow()
    } finally {
      removeTempDir(root)
    }
  })

  test('missing schema surfaces a clear error', async () => {
    const dir = makeTempDir()
    try {
      await expect(loadSensitiveItems(dir, { env: {} })).rejects.toThrow(/no \.env\.schema/)
    } finally {
      removeTempDir(dir)
    }
  })
})

describe('syncAll', () => {
  test('graph values; rootless only as non-root', async () => {
    const root = makeSecretInstance()
    try {
      const rec = recordingPodman()
      /** @type {string[]} */
      const logs = []
      const r = await syncAll({
        root,
        uid: 1000,
        env: {},
        podman: rec.podman,
        log: (m) => logs.push(m),
      })
      expect(r.synced).toBe(1)
      expect(rec.created).toEqual({ 'rootless/CADDY_DNS': 'real-dns-token' })
      expect(rec.hashes['rootless/CADDY_DNS']).toBe(secretContentHash('real-dns-token'))
      expect(logs).toContain('skip ACTIVE_DIRECTORY_ADMIN_PASSWORD (rootful; run as root)')
    } finally {
      removeTempDir(root)
    }
  })

  test('as root: rootful secrets sync too', async () => {
    const root = makeSecretInstance()
    try {
      const rec = recordingPodman()
      const r = await syncAll({ root, uid: 0, env: {}, podman: rec.podman, log: () => {} })
      expect(r.synced).toBe(2)
      expect(rec.created['rootful/ACTIVE_DIRECTORY_ADMIN_PASSWORD']).toBe('real-ad-pass')
    } finally {
      removeTempDir(root)
    }
  })

  test('second sync skips unchanged (hash label)', async () => {
    const root = makeSecretInstance()
    try {
      const rec = recordingPodman()
      const opts = { root, uid: 1000, env: {}, podman: rec.podman, log: () => {} }
      const first = await syncAll(opts)
      const second = await syncAll(opts)
      expect(first.synced).toBe(1)
      expect(second.synced).toBe(0)
      expect(second.skipped).toBe(1)
      expect(rec.calls.filter((c) => c.includes('secret rm'))).toEqual([])
      expect(rec.calls.filter((c) => c.includes('secret create')).length).toBe(1)
    } finally {
      removeTempDir(root)
    }
  })

  test('value change recreates secret', async () => {
    const root = makeSecretInstance()
    try {
      const rec = recordingPodman()
      const opts = { root, uid: 1000, env: {}, podman: rec.podman, log: () => {} }
      await syncAll(opts)
      writeFile(
        root,
        'applications/caddy/caddy/.env.schema',
        '# ---\n# @sensitive @required\nCADDY_DNS=new-token\n',
      )
      const r = await syncAll(opts)
      expect(r.synced).toBe(1)
      expect(r.changed).toEqual(['CADDY_DNS'])
      expect(rec.created['rootless/CADDY_DNS']).toBe('new-token')
    } finally {
      removeTempDir(root)
    }
  })

  test('--dry-run touches no podman', async () => {
    const root = makeSecretInstance()
    try {
      const rec = recordingPodman()
      /** @type {string[]} */
      const logs = []
      await syncAll({
        root,
        dryRun: true,
        uid: 0,
        env: {},
        podman: rec.podman,
        log: (m) => logs.push(m),
      })
      expect(rec.calls).toEqual([])
      expect(logs.some((l) => l.startsWith('dry-run: rootless secret create CADDY_DNS'))).toBe(true)
    } finally {
      removeTempDir(root)
    }
  })

  test('empty value / no schemas / duplicate names throw', async () => {
    const root = makeSecretInstance()
    try {
      const base = { root, uid: 0, env: {}, podman: recordingPodman().podman, log: () => {} }
      writeFile(
        root,
        'applications/caddy/caddy/.env.schema',
        '# ---\n# @sensitive @optional\nCADDY_DNS=\n',
      )
      await expect(syncAll({ ...base })).rejects.toThrow(/empty value for CADDY_DNS/)

      writeFile(
        root,
        'applications/caddy/caddy/.env.schema',
        '# ---\n# @sensitive\nCADDY_DNS=keep\n',
      )
      writeFile(
        root,
        'applications/ad/ad/.env.schema',
        '# ---\n# @sensitive\nCADDY_DNS=other-value\n',
      )
      await expect(syncAll({ ...base })).rejects.toThrow(/declared twice/)
    } finally {
      removeTempDir(root)
    }
    const bare = makeSecretInstance()
    try {
      removeTempDir(join(bare, 'applications'))
      await expect(syncAll({ root: bare, env: {}, uid: 0, log: () => {} })).rejects.toThrow(
        /no unit \.env\.schema/,
      )
    } finally {
      removeTempDir(bare)
    }
  })
})
