import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir, writeFile } from '../test-helpers.js'
import {
  GUEST_TAG,
  declaresSensitive,
  hydrateSystemdCredentials,
  isSensitiveItem,
  keysWithTag,
  loadEnvGraphForDir,
  resolvedNonSensitive,
  resolvedSensitive,
  sensitiveKeys,
} from './index.js'
import { describe, expect, test } from 'bun:test'

const NO_ENV = { PATH: '/usr/bin' }

/**
 * Package-root + unit-dir tree (schemas import repo root).
 * @returns {string} root
 */
function makeTree() {
  const root = makeTempDir()
  writeFile(root, '.env.dev', 'ENV=dev\nFQDN=x.localhost\n')
  writeFile(root, '.env.prod', 'ENV=prod\nFQDN=x.eu\n')
  writeFile(
    root,
    '.env.schema',
    [
      '# @import(./.env.dev, enabled=eq($QCTL_ENV, "dev"))',
      '# @import(./.env.prod, enabled=eq($QCTL_ENV, "prod"))',
      '# ---',
      '# @type=enum(dev, prod)',
      '# @public',
      'QCTL_ENV=dev',
      '# @internal @public',
      'ENV=',
      '# @internal @public',
      'FQDN=',
    ].join('\n'),
  )

  // Package root (template scope)
  writeFile(
    root,
    'applications/web/.env.schema',
    [
      '# @import(../../)',
      '# ---',
      '# @public',
      'VERSION=1.2.3',
      '# @public',
      'IMAGE=img:${VERSION}',
      '# @public',
      'AD_IP=',
    ].join('\n'),
  )
  writeFile(root, 'applications/web/.env.dev', 'AD_IP=10.0.0.1\n')
  writeFile(root, 'applications/web/.env.prod', 'AD_IP=10.0.0.99\n')
  writeFile(root, 'applications/web/app.yaml', 'engine: rootless\n')

  // Unit dir (container scope)
  writeFile(
    root,
    'applications/web/web/.env.schema',
    [
      '# @import(../../../)',
      '# ---',
      '# @public',
      'PORT_NAME=web',
      '# @public',
      'HOST=https://${FQDN}',
      '# @sensitive',
      'DB_PASSWORD=',
      '# @sensitive @tag(cross-engine)',
      'API_TOKEN=',
    ].join('\n'),
  )
  writeFile(
    root,
    'applications/web/web/.env.dev',
    ['DB_PASSWORD=s3cret-value-123', 'API_TOKEN=tok-abcdefgh-456', ''].join('\n'),
  )
  writeFile(
    root,
    'applications/web/web/.env.prod',
    ['DB_PASSWORD=vw("rocky-x")', 'API_TOKEN=prod-tok', ''].join('\n'),
  )
  writeFile(
    root,
    'applications/web/web/web.container',
    '[Container]\nImage=${IMAGE}\nEnvironmentFile=.env\n',
  )
  return root
}

describe('loadEnvGraphForDir', () => {
  test('registers varlock() and keychain() builtins', async () => {
    const root = makeTempDir()
    try {
      writeFile(root, '.env.schema', ['# ---', '# @sensitive', 'TOKEN=', ''].join('\n'))
      writeFile(root, '.env.dev', 'TOKEN=varlock("local:not-a-real-ciphertext")\n')
      let err
      try {
        await loadEnvGraphForDir(root, { env: NO_ENV, qctlEnv: 'dev', skipCache: true })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(Error)
      expect(String(/** @type {Error} */ (err).message)).not.toMatch(/Unknown resolver function/)
      expect(String(/** @type {Error} */ (err).message)).toMatch(/Decryption failed|varlock\(\)/)
    } finally {
      removeTempDir(root)
    }
  })

  test('package root: directory entry + currentEnvFallback + hub', async () => {
    const root = makeTree()
    try {
      const pkg = `${root}/applications/web`
      const dev = await loadEnvGraphForDir(pkg, {
        env: NO_ENV,
        qctlEnv: 'dev',
        skipSensitive: true,
        skipCache: true,
      })
      expect(resolvedNonSensitive(dev, { includeInternal: true })).toMatchObject({
        QCTL_ENV: 'dev',
        ENV: 'dev',
        FQDN: 'x.localhost',
        VERSION: '1.2.3',
        IMAGE: 'img:1.2.3',
        AD_IP: '10.0.0.1',
      })

      const prod = await loadEnvGraphForDir(pkg, {
        env: NO_ENV,
        qctlEnv: 'prod',
        skipSensitive: true,
        skipCache: true,
      })
      expect(resolvedNonSensitive(prod, { includeInternal: true })).toMatchObject({
        ENV: 'prod',
        AD_IP: '10.0.0.99',
        FQDN: 'x.eu',
      })
    } finally {
      removeTempDir(root)
    }
  })

  test('unit dir: secrets + non-sensitive container keys', async () => {
    const root = makeTree()
    try {
      const unit = `${root}/applications/web/web`
      const g = await loadEnvGraphForDir(unit, { env: NO_ENV, qctlEnv: 'dev', skipCache: true })
      expect(resolvedNonSensitive(g, { includeInternal: true })).toMatchObject({
        PORT_NAME: 'web',
        HOST: 'https://x.localhost',
        FQDN: 'x.localhost',
      })
      expect(resolvedSensitive(g)).toEqual([
        { key: 'API_TOKEN', value: 'tok-abcdefgh-456' },
        { key: 'DB_PASSWORD', value: 's3cret-value-123' },
      ])
      expect([...keysWithTag(g, 'cross-engine')]).toEqual(['API_TOKEN'])
    } finally {
      removeTempDir(root)
    }
  })

  test('extraEntryPaths: additional absolute entry file', async () => {
    const root = makeTempDir()
    try {
      writeFile(
        root,
        '.env.schema',
        '# ---\n# @type=enum(dev, prod)\n# @public\nQCTL_ENV=dev\n# @public @optional\nENV=\n',
      )
      writeFile(root, '.env.dev', 'ENV=dev\n')
      writeFile(root, '.env.extra', 'VW_CLIENT_ID=cid\nVW_CLIENT_SECRET=csec\n')
      const g = await loadEnvGraphForDir(root, {
        env: NO_ENV,
        qctlEnv: 'dev',
        skipCache: true,
        extraEntryPaths: [`${root}/.env.extra`],
      })
      expect(resolvedSensitive(g)).toEqual([
        { key: 'VW_CLIENT_ID', value: 'cid' },
        { key: 'VW_CLIENT_SECRET', value: 'csec' },
      ])
    } finally {
      removeTempDir(root)
    }
  })

  test('missing schema is an error', async () => {
    const root = makeTempDir()
    try {
      await expect(loadEnvGraphForDir(root, { env: NO_ENV, skipCache: true })).rejects.toThrow(
        /no \.env\.schema/,
      )
    } finally {
      removeTempDir(root)
    }
  })

  test('schema errors (bad import) throw', async () => {
    const root = makeTempDir()
    try {
      writeFile(root, '.env.schema', '# @import(./.env.nope)\n# ---\nA=1\n')
      await expect(loadEnvGraphForDir(root, { env: NO_ENV, skipCache: true })).rejects.toThrow(
        /invalid schema.*does not exist/s,
      )
    } finally {
      removeTempDir(root)
    }
  })

  test('unknown vw() throws', async () => {
    const root = makeTempDir()
    try {
      writeFile(
        root,
        '.env.schema',
        '# ---\n# @sensitive @required\nPW=vw("rocky-x")\n# @public\nPLAIN=ok\n',
      )
      writeFile(root, '.env.dev', 'PW=vw("rocky-x")\n')
      await expect(
        loadEnvGraphForDir(root, { env: NO_ENV, qctlEnv: 'dev', skipCache: true }),
      ).rejects.toThrow(/PW: Unknown resolver function: vw/)
    } finally {
      removeTempDir(root)
    }
  })

  test('skipSensitive never resolves @sensitive items', async () => {
    const root = makeTempDir()
    try {
      writeFile(root, '.env.schema', '# ---\n# @sensitive @required\nPW=\n# @public\nPLAIN=ok\n')
      const g = await loadEnvGraphForDir(root, {
        env: NO_ENV,
        skipSensitive: true,
        skipCache: true,
      })
      expect(resolvedNonSensitive(g)).toEqual({ PLAIN: 'ok' })
      expect([...sensitiveKeys(g)]).toEqual(['PW'])
    } finally {
      removeTempDir(root)
    }
  })
})

describe('filters', () => {
  test('@internal only with includeInternal; sensitive never in non-sensitive map', async () => {
    const root = makeTree()
    try {
      const g = await loadEnvGraphForDir(`${root}/applications/web`, {
        env: NO_ENV,
        qctlEnv: 'dev',
        skipSensitive: true,
        skipCache: true,
      })
      const pub = resolvedNonSensitive(g)
      expect(pub.FQDN).toBeUndefined()
      expect(pub.VERSION).toBe('1.2.3')
      const all = resolvedNonSensitive(g, { includeInternal: true })
      expect(all.FQDN).toBe('x.localhost')
      expect(all.DB_PASSWORD).toBeUndefined()
      const version = g.configSchema.VERSION
      expect(version && isSensitiveItem(version)).toBe(false)
      expect(version && declaresSensitive(version)).toBe(false)
    } finally {
      removeTempDir(root)
    }
  })
})

describe('hydrateSystemdCredentials', () => {
  test('loads CREDENTIALS_DIRECTORY files by filename as env keys', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'creds'), { recursive: true })
      writeFileSync(join(dir, 'creds', 'VW_CLIENT_ID'), 'id-from-file\n')
      writeFileSync(join(dir, 'creds', 'VW_CLIENT_SECRET'), 'secret-from-file\n')
      /** @type {Record<string, string | undefined>} */
      const ov = { CREDENTIALS_DIRECTORY: join(dir, 'creds') }
      const keys = hydrateSystemdCredentials(ov)
      expect(ov.VW_CLIENT_ID).toBe('id-from-file')
      expect(ov.VW_CLIENT_SECRET).toBe('secret-from-file')
      expect(keys).toContain('VW_CLIENT_ID')
      expect(GUEST_TAG).toBe('guest')
    } finally {
      removeTempDir(dir)
    }
  })

  test('graph @tag(guest) @required fails when credential missing', async () => {
    const root = makeTempDir()
    try {
      writeFile(root, '.env.schema', '# ---\n# @tag(guest) @internal\nVW_CLIENT_ID=\n')
      await expect(loadEnvGraphForDir(root, { env: NO_ENV, skipCache: true })).rejects.toThrow(
        /@tag\(guest\)/,
      )
    } finally {
      removeTempDir(root)
    }
  })

  test('graph hydrates @tag(guest) from CREDENTIALS_DIRECTORY', async () => {
    const root = makeTempDir()
    try {
      const creds = join(root, 'creds')
      mkdirSync(creds, { recursive: true })
      writeFileSync(join(creds, 'VW_CLIENT_ID'), 'hydrated-id')
      writeFile(root, '.env.schema', '# ---\n# @tag(guest) @internal\nVW_CLIENT_ID=\n')
      const g = await loadEnvGraphForDir(root, {
        env: { ...NO_ENV, CREDENTIALS_DIRECTORY: creds },
        skipCache: true,
      })
      // @internal guest secrets are for @initVw refs, not Podman sync
      expect(g.configSchema.VW_CLIENT_ID?.resolvedValue).toBe('hydrated-id')
      expect(resolvedSensitive(g)).toEqual([])
    } finally {
      removeTempDir(root)
    }
  })
})
