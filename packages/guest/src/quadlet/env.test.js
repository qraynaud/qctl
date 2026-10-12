import { join } from 'node:path'

import { removeTempDir, writeFile } from '@qctl/shared/test-helpers'

import {
  detectQctlEnvFor,
  envFileValue,
  isPathKey,
  loadNetworkRenderEnv,
  loadRenderEnv,
  renderFile,
  renderUnitEnvFile,
  runtimeUnitDirs,
  substitute,
} from './env.js'
import { makeQuadletInstance, packageSchema, unitSchema } from './test/fixture.js'
import { describe, expect, test } from 'bun:test'

/** @param {string} root @param {string} seedDir */
const ctxOf = (root, seedDir, env = {}) => ({ root, baseEnv: { PATH: '/bin', ...env }, seedDir })

describe('name helpers', () => {
  test('path keys', () => {
    expect(isPathKey('TANK_ROOT')).toBe(true)
    expect(isPathKey('FOO_DIR')).toBe(true)
    expect(isPathKey('REPO_ROOT')).toBe(false)
    expect(isPathKey('TZ')).toBe(false)
  })
})

describe('render env', () => {
  test('package-root graph + .env.<ENV> autoload; path keys absolutized; REPO_ROOT', async () => {
    const fx = makeQuadletInstance()
    try {
      const renv = await loadRenderEnv(
        ctxOf(fx.root, join(fx.sysDir, 'seed')),
        join(fx.root, 'applications/web'),
      )
      expect(renv.qctlEnv).toBe('dev') // from the repo .env link (no QCTL_ENV in the process env)
      expect(renv.scope.TANK_ROOT).toBe(join(fx.root, 'volumes'))
      expect(renv.scope.VERSION).toBe('2.0-dev')
      expect(renv.scope.APPS_UID).toBe('1000')
      expect(renv.substKeys).toContain('REPO_ROOT')
      expect(renv.appEnvLabel).toBe(join(fx.root, 'applications/web'))
      expect(renv.scope.VW_CLIENT_SECRET).toBeUndefined() // @sensitive never enters the scope

      const out = renderFile(join(fx.root, 'applications/web/web/web.container'), renv)
      expect(out).toContain('Image=img/web:2.0-dev')
      expect(out).toContain(`Volume=${join(fx.root, 'volumes')}/web:/data`)
      expect(out).toContain('Label=host=x.localhost')
      expect(out).toContain('EnvironmentFile=.env')
      expect(out.endsWith('\n')).toBe(true)
      expect(out.endsWith('\n\n')).toBe(false)
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })

  test('QCTL_ENV: process env wins, else repo .env ENV=, else dev; selects .env.<ENV>', async () => {
    const fx = makeQuadletInstance()
    try {
      const seed = join(fx.sysDir, 'seed')
      expect(detectQctlEnvFor(fx.root, { QCTL_ENV: 'prod' })).toBe('prod')
      expect(detectQctlEnvFor(fx.root, {})).toBe('dev')
      expect(detectQctlEnvFor(join(fx.root, 'nope'), {})).toBe('dev')
      writeFile(fx.root, '.env', 'ENV=prod\n')
      expect(detectQctlEnvFor(fx.root, {})).toBe('prod')

      const prod = await loadRenderEnv(ctxOf(fx.root, seed), join(fx.root, 'applications/web'))
      expect(prod.qctlEnv).toBe('prod')
      expect(prod.scope.FQDN).toBe('x.eu')
      expect(prod.scope.TANK_ROOT).toBe('/tank/apps')
      expect(prod.scope.VERSION).toBe('2.0')
      const dev = await loadRenderEnv(
        ctxOf(fx.root, seed, { QCTL_ENV: 'dev' }),
        join(fx.root, 'applications/web'),
      )
      expect(dev.scope.FQDN).toBe('x.localhost')
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })

  test('app keys do not leak between apps', async () => {
    const fx = makeQuadletInstance()
    try {
      const c = ctxOf(fx.root, join(fx.sysDir, 'seed'))
      const web = await loadRenderEnv(c, join(fx.root, 'applications/web'))
      const proxy = await loadRenderEnv(c, join(fx.root, 'applications/proxy'))
      expect(web.scope.VERSION).toBe('2.0-dev')
      expect(proxy.scope.VERSION).toBe('1.0')
      expect(proxy.scope.A).toBeUndefined()
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })

  test('seed-baked env: VLAN*_PARENT substitutable', async () => {
    const fx = makeQuadletInstance()
    try {
      writeFile(fx.sysDir, 'seed/vlan-parents.env', 'VLAN2_PARENT=bond0\n')
      const renv = await loadRenderEnv(
        ctxOf(fx.root, join(fx.sysDir, 'seed')),
        join(fx.root, 'applications/proxy'),
      )
      expect(substitute('${VLAN2_PARENT}', renv, 'x')).toBe('bond0\n')
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })

  test('network render env: networks/<n>/.env.schema + .env.<ENV>', async () => {
    const fx = makeQuadletInstance()
    try {
      const f = join(fx.root, 'networks/lan/lan.network')
      const renv = await loadNetworkRenderEnv(ctxOf(fx.root, join(fx.sysDir, 'seed')), f)
      expect(renderFile(f, renv)).toContain('Options=parent=eth9')
      expect(renv.scope.FQDN).toBe('x.localhost')
      expect(renv.scope.VW_CLIENT_SECRET).toBeUndefined()
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })

  test('unresolved ${VAR} is an error naming the var', async () => {
    const fx = makeQuadletInstance()
    try {
      const renv = await loadRenderEnv(
        ctxOf(fx.root, join(fx.sysDir, 'seed')),
        join(fx.root, 'applications/proxy'),
      )
      expect(() => substitute('a=${NOPE}\nb=${REPO_ROOT}', renv, 't.container')).toThrow(
        /unresolved.*\n\$\{NOPE\}/s,
      )
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })

  test('app dir with env files but no .env.schema is an error; bare dir is fine', async () => {
    const fx = makeQuadletInstance()
    try {
      const c = ctxOf(fx.root, join(fx.sysDir, 'seed'))
      const bare = join(fx.root, 'applications/empty')
      writeFile(fx.root, 'applications/empty/app.yaml', 'engine: rootless\n')
      expect((await loadRenderEnv(c, bare)).scope.REPO_ROOT).toBe(fx.root)
      writeFile(fx.root, 'applications/empty/.env.dev', 'X=1\n')
      await expect(loadRenderEnv(c, bare)).rejects.toThrow(/no package-root \.env\.schema/)
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })

  test('schema errors surface (bad import)', async () => {
    const fx = makeQuadletInstance()
    try {
      writeFile(fx.root, 'applications/proxy/.env.schema', '# @import(./.env.nope)\n# ---\nA=1\n')
      await expect(
        loadRenderEnv(ctxOf(fx.root, join(fx.sysDir, 'seed')), join(fx.root, 'applications/proxy')),
      ).rejects.toThrow(/invalid schema/)
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })
})

describe('@sensitive keys', () => {
  test('rejected when assigned in package-root .env.<ENV>', async () => {
    const fx = makeQuadletInstance()
    try {
      const c = ctxOf(fx.root, join(fx.sysDir, 'seed'))
      const dir = join(fx.root, 'applications/proxy')
      writeFile(
        fx.root,
        'applications/proxy/.env.schema',
        packageSchema(['# @sensitive', 'TOKEN=', 'VERSION=']),
      )
      writeFile(fx.root, 'applications/proxy/.env.dev', 'VERSION=1.0\n')
      expect((await loadRenderEnv(c, dir)).scope.TOKEN).toBeUndefined()

      writeFile(fx.root, 'applications/proxy/.env.dev', 'VERSION=1.0\nTOKEN=inline\n')
      await expect(loadRenderEnv(c, dir)).rejects.toThrow(
        /@sensitive key TOKEN must not be assigned/,
      )
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })
})

describe('unit EnvironmentFile=.env', () => {
  test('envFileValue: bare unless whitespace / quotes / backslash', () => {
    expect(envFileValue('https://a.b:80/x,y')).toBe('https://a.b:80/x,y')
    expect(envFileValue('')).toBe('')
    expect(envFileValue('a b')).toBe('"a b"')
    expect(envFileValue('say "hi"')).toBe('"say \\"hi\\""')
    expect(envFileValue('c:\\x')).toBe('"c:\\\\x"')
  })

  test('runtimeUnitDirs = unit folders with .env.schema; values from unit graph', async () => {
    const fx = makeQuadletInstance()
    try {
      const dir = join(fx.root, 'applications/web')
      expect(runtimeUnitDirs(dir).map((f) => f.slice(dir.length + 1))).toEqual(['web'])
      const renv = await loadRenderEnv(ctxOf(fx.root, join(fx.sysDir, 'seed')), dir)
      expect(
        await renderUnitEnvFile(join(dir, 'web'), renv, ctxOf(fx.root, join(fx.sysDir, 'seed'))),
      ).toBe('A=2\nB=x.localhost\nC=3\n')
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })

  test('unit .env.<ENV> can reference graph keys; sensitive keys omitted', async () => {
    const fx = makeQuadletInstance()
    try {
      const dir = join(fx.root, 'applications/web')
      writeFile(
        fx.root,
        'applications/web/web/.env.schema',
        unitSchema(['A=', 'B=', 'C=', '# @sensitive', 'TOKEN=']),
      )
      writeFile(
        fx.root,
        'applications/web/web/.env.dev',
        'A=1\nB=${FQDN}\nC=https://${FQDN}\nTOKEN=secret\n',
      )
      const renv = await loadRenderEnv(ctxOf(fx.root, join(fx.sysDir, 'seed')), dir)
      expect(
        await renderUnitEnvFile(join(dir, 'web'), renv, ctxOf(fx.root, join(fx.sysDir, 'seed'))),
      ).toBe('A=1\nB=x.localhost\nC=https://x.localhost\n')
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })
})
