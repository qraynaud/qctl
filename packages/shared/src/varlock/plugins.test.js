import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir } from '../test-helpers.js'
import {
  VARLOCK_UNRESOLVED_PLUGIN_RE,
  ensurePackageDependencies,
  findPackageRoot,
  installPackageDependencies,
  isPackageInstalled,
  isVarlockUnresolvedPluginError,
  packageDepsSatisfied,
  readPackageDependencyMap,
  shouldUseFrozenPackageInstall,
} from './plugins.js'
import { describe, expect, test } from 'bun:test'

/**
 * @returns {Promise<string>}
 */
async function tempDir() {
  return makeTempDir('qctl-pkg-')
}

describe('isVarlockUnresolvedPluginError', () => {
  test('matches the live varlock unresolved-plugin wording', () => {
    const sample =
      'Plugin "@qctl/does-not-exist-plugin" unable to resolve - install locally via your package.json file'
    expect(VARLOCK_UNRESOLVED_PLUGIN_RE.test(sample)).toBe(true)
    expect(isVarlockUnresolvedPluginError(sample)).toBe(true)
    expect(isVarlockUnresolvedPluginError('unrelated parse error')).toBe(false)
  })
})

describe('shouldUseFrozenPackageInstall', () => {
  test('true when CI=true', () => {
    expect(shouldUseFrozenPackageInstall({ env: { CI: 'true' }, qctlEnv: 'dev' })).toBe(true)
  })

  test('true when qctlEnv is production (built-in prod)', () => {
    expect(shouldUseFrozenPackageInstall({ env: {}, qctlEnv: 'prod' })).toBe(true)
  })

  test('false for non-production custom env without CI', () => {
    expect(
      shouldUseFrozenPackageInstall({
        env: {},
        qctlEnv: 'staging',
        environments: {
          staging: { production: false },
          prod: { production: true },
        },
      }),
    ).toBe(false)
  })

  test('true when custom env is marked production', () => {
    expect(
      shouldUseFrozenPackageInstall({
        env: {},
        qctlEnv: 'eu-prod',
        environments: { 'eu-prod': { production: true } },
      }),
    ).toBe(true)
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

  test('ensurePackageDependencies no-ops without package.json', async () => {
    const dir = await tempDir()
    const r = await ensurePackageDependencies(dir)
    expect(r.root).toBeNull()
    expect(r.installed).toBe(false)
  })

  test('ensurePackageDependencies no-ops when dependencies are empty', async () => {
    const root = await tempDir()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', private: true }))
    const r = await ensurePackageDependencies(root, { env: { CI: 'true' }, qctlEnv: 'dev' })
    expect(r.installed).toBe(false)
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

    expect(packageDepsSatisfied(root)).toBe(false)
    // Mutable install — CI=true would require a lockfile.
    const ensureOpts = { env: { CI: 'false' }, qctlEnv: 'dev' }
    const r = await ensurePackageDependencies(root, ensureOpts)
    expect(r.root).toBe(root)
    expect(r.installed).toBe(true)
    expect(r.frozen).toBe(false)
    expect(isPackageInstalled(root, '@qctl/fake-plugin')).toBe(true)
    expect(packageDepsSatisfied(root)).toBe(true)

    const again = await ensurePackageDependencies(root, ensureOpts)
    expect(again.installed).toBe(false)
  }, 60_000)

  test('installPackageDependencies omits devDependencies', async () => {
    const root = await tempDir()
    const prodSrc = join(root, 'prod-plugin')
    const devSrc = join(root, 'dev-plugin')
    for (const [dir, name] of [
      [prodSrc, '@qctl/prod-plugin'],
      [devSrc, '@qctl/dev-plugin'],
    ]) {
      mkdirSync(join(dir, 'dist'), { recursive: true })
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', main: 'dist/index.cjs' }),
      )
      writeFileSync(join(dir, 'dist/index.cjs'), 'module.exports = {}\n')
    }
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'inst',
        private: true,
        dependencies: { '@qctl/prod-plugin': `file:${prodSrc}` },
        devDependencies: { '@qctl/dev-plugin': `file:${devSrc}` },
      }),
    )

    await installPackageDependencies(root, { frozen: false })
    expect(isPackageInstalled(root, '@qctl/prod-plugin')).toBe(true)
    expect(isPackageInstalled(root, '@qctl/dev-plugin')).toBe(false)
  }, 60_000)
})
