import { makeTempDir, removeTempDir, writeFile } from '../test-helpers.js'
import { loadEnvGraphForDir } from './load.js'
import { resolvedNonSensitive } from './project.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** Empty env so tests do not inherit host secrets. */
const NO_ENV = /** @type {Record<string, string | undefined>} */ ({})

/** @type {string[]} */
const temps = []

afterEach(() => {
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
})
