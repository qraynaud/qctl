import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  collectNpmPluginPins,
  collectNpmPluginPinsFromDir,
  ensurePackageDependencies,
  findPackageRoot,
  installPackageDependencies,
  isPackageInstalled,
  packageDepsSatisfied,
  parseNpmPluginDescriptor,
  parseNpmPluginRef,
  readPackageDependencyMap,
  shouldUseFrozenPackageInstall,
} from './plugins.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(async () => {
  const { rmSync } = await import('node:fs')
  while (temps.length) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * @returns {Promise<string>}
 */
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'qctl-pkg-'))
  temps.push(dir)
  return dir
}

describe('collectNpmPluginPins', () => {
  test('collects versioned and unversioned npm refs; skips local paths', () => {
    const pins = collectNpmPluginPins(
      [
        '# @plugin(@qctl/vaultwarden-plugin)',
        '# @plugin(./local-plugin)',
        '# @plugin(@varlock/bitwarden-plugin@1.2.3)',
        '# @plugin(@qctl/vaultwarden-plugin@0.1.1)',
        '# @plugin(some-plugin)',
        '',
      ].join('\n'),
    )
    expect(pins.map((p) => p.descriptor).sort()).toEqual([
      '@qctl/vaultwarden-plugin@0.1.1',
      '@varlock/bitwarden-plugin@1.2.3',
      'some-plugin',
    ])
  })
})

describe('collectNpmPluginPinsFromDir', () => {
  test('scans .env* files in a directory', async () => {
    const dir = await tempDir()
    writeFileSync(join(dir, '.env.schema'), '# ---\nX=\n')
    writeFileSync(join(dir, '.env.prod'), '# @plugin(@qctl/vaultwarden-plugin)\nTANK_PASSPHRASE=\n')
    writeFileSync(join(dir, 'readme.txt'), '# @plugin(ignored@1.0.0)\n')
    const pins = collectNpmPluginPinsFromDir(dir)
    expect(pins).toEqual([
      {
        moduleName: '@qctl/vaultwarden-plugin',
        descriptor: '@qctl/vaultwarden-plugin',
      },
    ])
  })
})

describe('parseNpmPluginRef / parseNpmPluginDescriptor', () => {
  test('parses unversioned scoped name', () => {
    expect(parseNpmPluginRef('@qctl/vaultwarden-plugin')).toEqual({
      moduleName: '@qctl/vaultwarden-plugin',
      descriptor: '@qctl/vaultwarden-plugin',
    })
  })

  test('parses scoped name@version', () => {
    expect(parseNpmPluginDescriptor('@qctl/vaultwarden-plugin@0.1.5')).toEqual({
      moduleName: '@qctl/vaultwarden-plugin',
      version: '0.1.5',
      descriptor: '@qctl/vaultwarden-plugin@0.1.5',
    })
  })
})

describe('shouldUseFrozenPackageInstall', () => {
  test('true when CI=true', () => {
    expect(shouldUseFrozenPackageInstall({ env: { CI: 'true' }, qctlEnv: 'dev' })).toBe(true)
  })

  test('true when qctlEnv is not dev', () => {
    expect(shouldUseFrozenPackageInstall({ env: {}, qctlEnv: 'prod' })).toBe(true)
  })

  test('false for local dev without CI', () => {
    expect(shouldUseFrozenPackageInstall({ env: { CI: 'false' }, qctlEnv: 'dev' })).toBe(false)
    expect(shouldUseFrozenPackageInstall({ env: {}, qctlEnv: 'dev' })).toBe(false)
  })
})

describe('findPackageRoot / package deps', () => {
  test('walks up to package.json', async () => {
    const root = await tempDir()
    const nested = join(root, 'provision')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"name":"inst","private":true}\n')
    expect(findPackageRoot(nested)).toBe(root)
    expect(findPackageRoot(root)).toBe(root)
  })

  test('readPackageDependencyMap merges optional + dependencies', async () => {
    const root = await tempDir()
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { a: '1.0.0' },
        optionalDependencies: { b: '2.0.0' },
      }),
    )
    expect(readPackageDependencyMap(root)).toEqual({ b: '2.0.0', a: '1.0.0' })
  })

  test('ensurePackageDependencies errors when pins lack package.json', async () => {
    const dir = await tempDir()
    writeFileSync(join(dir, '.env.dev'), '# @plugin(@qctl/vaultwarden-plugin)\n# ---\nX=1\n')
    await expect(ensurePackageDependencies(dir)).rejects.toThrow(/requires a package\.json/)
  })

  test('ensurePackageDependencies errors when pin missing from dependencies', async () => {
    const root = await tempDir()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', private: true }))
    writeFileSync(join(root, '.env.dev'), '# @plugin(@qctl/vaultwarden-plugin)\n# ---\nX=1\n')
    await expect(ensurePackageDependencies(root)).rejects.toThrow(/missing dependencies/)
  })

  test('frozen install fails without package-lock.json', async () => {
    const root = await tempDir()
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'inst', private: true, dependencies: { leftpad: '1.0.0' } }),
    )
    await expect(installPackageDependencies(root, { frozen: true })).rejects.toThrow(
      /frozen install requires package-lock\.json/,
    )
  })

  test('ensurePackageDependencies installs file: plugin into node_modules', async () => {
    const root = await tempDir()
    const pluginSrc = join(root, 'fake-plugin')
    mkdirSync(join(pluginSrc, 'dist'), { recursive: true })
    writeFileSync(
      join(pluginSrc, 'package.json'),
      JSON.stringify({
        name: '@qctl/fake-plugin',
        version: '1.0.0',
        main: 'dist/index.cjs',
      }),
    )
    writeFileSync(join(pluginSrc, 'dist/index.cjs'), 'module.exports = {}\n')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'inst',
        private: true,
        dependencies: { '@qctl/fake-plugin': `file:${pluginSrc}` },
      }),
    )
    writeFileSync(join(root, '.env.dev'), '# @plugin(@qctl/fake-plugin)\n# ---\nX=1\n')

    expect(packageDepsSatisfied(root)).toBe(false)
    const r = await ensurePackageDependencies(root)
    expect(r.root).toBe(root)
    expect(r.installed).toBe(true)
    expect(isPackageInstalled(root, '@qctl/fake-plugin')).toBe(true)
    expect(packageDepsSatisfied(root)).toBe(true)

    const again = await ensurePackageDependencies(root)
    expect(again.installed).toBe(false)
  }, 60_000)
})
