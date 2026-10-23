import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  applyPackagesFilesAnswers,
  defaultPackagesFilesAnswers,
  filesToPlain,
  packagesIsEmpty,
  packagesToPlain,
  readHostFileContent,
} from './packages-files.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('packagesToPlain / filesToPlain', () => {
  test('omits empty packages', () => {
    expect(packagesIsEmpty({ distro: [], pipx: [], http: [] })).toBe(true)
    expect(packagesToPlain({ distro: [], pipx: [], http: [] })).toBeNull()
  })

  test('emits distro, object pipx, http', () => {
    expect(
      packagesToPlain({
        distro: ['nano'],
        pipx: ['cowsay', { package: 'tool', inject: ['a'] }],
        http: [{ url: 'https://ex.com/a.zip', bin: 'a', test: 'true' }],
      }),
    ).toEqual({
      distro: ['nano'],
      pipx: ['cowsay', { package: 'tool', inject: ['a'] }],
      http: [{ url: 'https://ex.com/a.zip', bin: 'a', test: 'true' }],
    })
  })

  test('filesToPlain keeps optional owner/mode', () => {
    expect(
      filesToPlain([{ path: '/etc/x', content: 'hi', owner: 'root:root', permissions: '0644' }]),
    ).toEqual([{ path: '/etc/x', content: 'hi', owner: 'root:root', permissions: '0644' }])
  })
})

describe('readHostFileContent', () => {
  test('reads absolute path', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const path = join(dir, 't.conf')
    writeFileSync(path, 'key=value\n', 'utf8')
    expect(readHostFileContent(path)).toBe('key=value\n')
  })
})

describe('applyPackagesFilesAnswers', () => {
  test('writes packages + files to env yaml', () => {
    const root = join(makeTempDir(), 'pf')
    temps.push(join(root, '..'))
    mkdirSync(join(root, 'provision'), { recursive: true })

    applyPackagesFilesAnswers(
      root,
      {
        shared: false,
        packages: {
          distro: ['nano'],
          pipx: [],
          http: [],
        },
        files: [{ path: '/etc/example.conf', content: 'a=b\n' }],
      },
      {
        profiles: { lab: { env: 'dev', target: 'workstation' } },
        environments: { dev: {} },
      },
    )

    const env = readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')
    expect(env).toContain('packages:')
    expect(env).toContain('nano')
    expect(env).toContain('files:')
    expect(env).toContain('path: /etc/example.conf')
    expect(env).toContain('a=b')
  })

  test('defaults write nothing', () => {
    const root = join(makeTempDir(), 'pf2')
    temps.push(join(root, '..'))
    mkdirSync(join(root, 'provision'), { recursive: true })
    applyPackagesFilesAnswers(root, defaultPackagesFilesAnswers(false), {
      profiles: { lab: { env: 'dev', target: 'workstation' } },
      environments: { dev: {} },
    })
    expect(() => readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')).toThrow()
  })
})
