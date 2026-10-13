import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir, writeFile } from '../test-helpers.js'
import { loadEnvGraphForDir } from './load.js'
import * as plugins from './plugins.js'
import { VARLOCK_UNRESOLVED_PLUGIN_RE } from './plugins.js'
import { resolvedNonSensitive } from './project.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** Empty env so tests do not inherit host secrets. */
const NO_ENV = /** @type {Record<string, string | undefined>} */ ({})

/** @type {string[]} */
const temps = []

afterEach(() => {
  // @ts-expect-error restore
  plugins.ensurePackageDependencies.mockRestore?.()
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('loadEnvGraphForDir', () => {
  test('throws when .env.schema is missing', async () => {
    const root = makeTempDir()
    temps.push(root)
    await expect(loadEnvGraphForDir(root, { env: NO_ENV, skipCache: true })).rejects.toThrow(
      /no \.env\.schema/,
    )
  })

  test('loads directory entry with currentEnvFallback', async () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      '.env.schema',
      [
        '# ---',
        '# @type=enum(dev, prod)',
        '# @public',
        'QCTL_ENV=dev',
        '# @public',
        'ENV=',
        '',
      ].join('\n'),
    )
    writeFile(root, '.env.dev', 'ENV=dev\n')
    const g = await loadEnvGraphForDir(root, {
      env: NO_ENV,
      qctlEnv: 'dev',
      skipSensitive: true,
      skipCache: true,
    })
    expect(resolvedNonSensitive(g, { includeInternal: true })).toMatchObject({
      QCTL_ENV: 'dev',
      ENV: 'dev',
    })
  })

  test('extraEntryPaths appends absolute entry files', async () => {
    const root = makeTempDir()
    temps.push(root)
    writeFile(
      root,
      '.env.schema',
      [
        '# ---',
        '# @type=enum(dev, prod)',
        '# @public',
        'QCTL_ENV=dev',
        '# @public @optional',
        'ENV=',
        '# @public @optional',
        'EXTRA_KEY=',
        '',
      ].join('\n'),
    )
    writeFile(root, '.env.dev', 'ENV=dev\n')
    writeFile(root, '.env.extra', 'EXTRA_KEY=extra-value\n')
    const g = await loadEnvGraphForDir(root, {
      env: NO_ENV,
      qctlEnv: 'dev',
      skipCache: true,
      extraEntryPaths: [`${root}/.env.extra`],
    })
    expect(resolvedNonSensitive(g, { includeInternal: true }).EXTRA_KEY).toBe('extra-value')
  })

  test('reifies once when varlock reports unresolved # @plugin (mocked ensure)', async () => {
    const root = makeTempDir()
    temps.push(root)
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'inst',
        private: true,
        dependencies: { '@qctl/does-not-exist-plugin': '1.0.0' },
      }),
    )
    writeFile(root, '.env.schema', ['# ---', '# @public @optional', 'X=', ''].join('\n'))
    writeFile(
      root,
      '.env.dev',
      ['# @plugin(@qctl/does-not-exist-plugin)', '# ---', 'X=1', ''].join('\n'),
    )

    const ensure = spyOn(plugins, 'ensurePackageDependencies').mockResolvedValue({
      root,
      installed: true,
      frozen: false,
    })

    await expect(
      loadEnvGraphForDir(root, {
        env: NO_ENV,
        qctlEnv: 'dev',
        skipCache: true,
      }),
    ).rejects.toThrow(VARLOCK_UNRESOLVED_PLUGIN_RE)

    expect(ensure).toHaveBeenCalledTimes(1)
    expect(ensure.mock.calls[0]?.[0]).toBe(root)
  })

  test('skipPluginEnsure does not reify on unresolved plugin', async () => {
    const root = makeTempDir()
    temps.push(root)
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'inst',
        private: true,
        dependencies: { '@qctl/does-not-exist-plugin': '1.0.0' },
      }),
    )
    writeFile(root, '.env.schema', ['# ---', '# @public @optional', 'X=', ''].join('\n'))
    writeFile(
      root,
      '.env.dev',
      ['# @plugin(@qctl/does-not-exist-plugin)', '# ---', 'X=1', ''].join('\n'),
    )

    const ensure = spyOn(plugins, 'ensurePackageDependencies').mockResolvedValue({
      root,
      installed: true,
      frozen: false,
    })

    await expect(
      loadEnvGraphForDir(root, {
        env: NO_ENV,
        qctlEnv: 'dev',
        skipCache: true,
        skipPluginEnsure: true,
      }),
    ).rejects.toThrow(VARLOCK_UNRESOLVED_PLUGIN_RE)

    expect(ensure).not.toHaveBeenCalled()
  })

  test('installs file: plugin via one-shot reify then loads graph', async () => {
    const root = makeTempDir()
    temps.push(root)
    const pluginSrc = join(root, 'fake-plugin')
    writeFile(
      pluginSrc,
      'package.json',
      JSON.stringify({
        name: '@qctl/fake-plugin',
        version: '1.0.0',
        main: 'index.cjs',
        exports: { '.': './index.cjs', './plugin': './index.cjs' },
      }),
    )
    writeFile(
      pluginSrc,
      'index.cjs',
      ["const { plugin } = require('varlock/plugin-lib')", "plugin.name = 'qctl-fake'", ''].join(
        '\n',
      ),
    )
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'inst',
        private: true,
        dependencies: { '@qctl/fake-plugin': `file:${pluginSrc}` },
      }),
    )
    writeFile(root, '.env.schema', ['# ---', '# @public @optional', 'X=', ''].join('\n'))
    writeFile(root, '.env.dev', ['# @plugin(@qctl/fake-plugin)', '# ---', 'X=ok', ''].join('\n'))

    const g = await loadEnvGraphForDir(root, {
      env: { ...NO_ENV, CI: 'false' },
      qctlEnv: 'dev',
      skipCache: true,
    })
    expect(resolvedNonSensitive(g, { includeInternal: true }).X).toBe('ok')
  }, 60_000)
})
