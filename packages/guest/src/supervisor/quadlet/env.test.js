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

/**
 * @param {string} root
 * @param {string} seedDir
 * @param {{ qctlEnv?: string, osConfig?: { env?: string } }} [extra]
 */
const ctxOf = (root, seedDir, extra = {}) => ({
  root,
  baseEnv: { PATH: '/bin' },
  seedDir,
  ...extra,
})

describe('name helpers', () => {
  test('path keys', () => {
    expect(isPathKey('APP_ROOT')).toBe(true)
    expect(isPathKey('FOO_DIR')).toBe(true)
    expect(isPathKey('TZ')).toBe(false)
  })
})

describe('render env', () => {
  test('package-root graph + .env.<ENV> autoload; path keys absolutized; __DIRNAME', async () => {
    const fx = makeQuadletInstance()
    try {
      const renv = await loadRenderEnv(
        ctxOf(fx.root, join(fx.sysDir, 'seed')),
        join(fx.root, 'applications/web'),
      )
      expect(renv.qctlEnv).toBe('dev') // from the repo .env link (no QCTL_ENV in the process env)
      expect(renv.scope.APP_ROOT).toBe(join(fx.root, 'volumes'))
      expect(renv.scope.VERSION).toBe('2.0-dev')
      expect(renv.scope.APPS_UID).toBe('1000')
      expect(renv.substKeys).not.toContain('REPO_ROOT')
      expect(renv.scope.REPO_ROOT).toBeUndefined()
      expect(renv.appEnvLabel).toBe(join(fx.root, 'applications/web'))
      expect(renv.scope.VW_CLIENT_SECRET).toBeUndefined() // @sensitive never enters the scope

      const unitDir = join(fx.root, 'applications/web/web')
      writeFile(fx.root, 'applications/web/web/sidecar.txt', 'x')
      writeFile(
        fx.root,
        'applications/web/web/web.container',
        [
          '[Container]',
          'Image=img/web:${VERSION}',
          'Volume=${APP_ROOT}/web:/data',
          'Volume=${__DIRNAME}/sidecar.txt:/sidecar:ro,Z',
          'Label=host=${FQDN}',
          'EnvironmentFile=.env',
          '',
        ].join('\n'),
      )
      const unit = join(unitDir, 'web.container')
      const out = renderFile(unit, renv)
      expect(out).toContain('Image=img/web:2.0-dev')
      expect(out).toContain(`Volume=${join(fx.root, 'volumes')}/web:/data`)
      expect(out).toContain(`Volume=${unitDir}/sidecar.txt:/sidecar:ro,Z`)
      expect(out).toContain('Label=host=x.localhost')
      expect(out).toContain('EnvironmentFile=.env')
      expect(out.endsWith('\n')).toBe(true)
      expect(out.endsWith('\n\n')).toBe(false)
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })

  test('env label: CLI/osConfig wins, else repo .env ENV=, else dev; selects .env.<ENV>', async () => {
    const fx = makeQuadletInstance()
    try {
      const seed = join(fx.sysDir, 'seed')
      expect(detectQctlEnvFor(fx.root, { qctlEnv: 'prod' })).toBe('prod')
      expect(detectQctlEnvFor(fx.root, { osConfigEnv: 'staging' })).toBe('staging')
      expect(detectQctlEnvFor(fx.root, {})).toBe('dev')
      expect(detectQctlEnvFor(join(fx.root, 'nope'), {})).toBe('dev')
      writeFile(fx.root, '.env', 'ENV=prod\n')
      expect(detectQctlEnvFor(fx.root, {})).toBe('prod')
      // Ambient QCTL_ENV must not win over OS config / .env.
      expect(detectQctlEnvFor(fx.root, { osConfigEnv: 'dev' })).toBe('dev')

      const prod = await loadRenderEnv(ctxOf(fx.root, seed), join(fx.root, 'applications/web'))
      expect(prod.qctlEnv).toBe('prod')
      expect(prod.scope.FQDN).toBe('x.eu')
      expect(prod.scope.APP_ROOT).toBe('/tank/apps')
      expect(prod.scope.VERSION).toBe('2.0')
      const dev = await loadRenderEnv(
        ctxOf(fx.root, seed, { qctlEnv: 'dev' }),
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

  test('seed-baked env: VLAN{n}_PARENT=iface (+ IPV4) substitutable', async () => {
    const fx = makeQuadletInstance()
    try {
      writeFile(
        fx.sysDir,
        'seed/vlan-parents.env',
        'VLAN2_PARENT=lab2\nVLAN2_IPV4=10.42.2.2\nVLAN_FOO_PARENT=nope\n',
      )
      const renv = await loadRenderEnv(
        ctxOf(fx.root, join(fx.sysDir, 'seed')),
        join(fx.root, 'applications/proxy'),
      )
      expect(substitute('${VLAN2_PARENT}', renv, 'x')).toBe('lab2\n')
      expect(substitute('${VLAN2_IPV4}', renv, 'x')).toBe('10.42.2.2\n')
      expect(renv.substKeys).toContain('VLAN2_PARENT')
      expect(renv.substKeys).not.toContain('VLAN_FOO_PARENT')
      expect(() => substitute('${VLAN_FOO_PARENT}', renv, 'x')).toThrow(/unresolved/)
    } finally {
      removeTempDir(fx.root)
      removeTempDir(fx.sysDir)
    }
  })

  test('interfaces overlay: label vlan2 → VLAN2_PARENT=<iface>', async () => {
    const fx = makeQuadletInstance()
    try {
      writeFile(fx.sysDir, 'seed/vlan-parents.env', 'VLAN2_PARENT=stale\n')
      const renv = await loadRenderEnv(
        {
          ...ctxOf(fx.root, join(fx.sysDir, 'seed')),
          interfaces: {
            main: { type: 'ethernet', iface: 'eth0' },
            vlan2: {
              type: 'dummy',
              iface: 'lab2',
              ipv4: { dhcp: false, addresses: ['10.0.2.2/24'] },
            },
          },
        },
        join(fx.root, 'applications/proxy'),
      )
      expect(renv.scope.VLAN2_PARENT).toBe('lab2')
      expect(renv.scope.VLAN2_IPV4).toBe('10.0.2.2')
      expect(substitute('parent=${VLAN2_PARENT}', renv, 'x')).toBe('parent=lab2\n')
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
      expect(() => substitute('a=${NOPE}\nb=${__DIRNAME}', renv, 't.container')).toThrow(
        /unresolved.*\n\$\{NOPE\}\n\$\{__DIRNAME\}/s,
      )
      expect(substitute('p=${__DIRNAME}/x', renv, 't.container', { dirname: '/abs/unit' })).toBe(
        'p=/abs/unit/x\n',
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
      expect((await loadRenderEnv(c, bare)).repoRoot).toBe(fx.root)
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
