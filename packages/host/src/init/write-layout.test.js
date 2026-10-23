import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  GITIGNORE_REQUIRED,
  MISE_QCTL_TOOL_LINE,
  ensureGitignore,
  ensureMiseToml,
  ensurePackageJson,
  ensureRootEnvSchema,
  packageJsonContents,
  writeLayout,
} from './write-layout.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('layout ensure helpers', () => {
  test('packageJsonContents sets name', () => {
    const pkg = JSON.parse(packageJsonContents('my-lab'))
    expect(pkg).toMatchObject({ name: 'my-lab', private: true, type: 'module' })
  })

  test('ensurePackageJson fills private/type/name', () => {
    const r = ensurePackageJson('{\n  "name": "old"\n}\n', 'new')
    expect(r.changed).toBe(true)
    expect(JSON.parse(r.text)).toMatchObject({
      name: 'new',
      private: true,
      type: 'module',
    })
  })

  test('ensureMiseToml adds tools + qctl line', () => {
    const r = ensureMiseToml('# hi\n')
    expect(r.changed).toBe(true)
    expect(r.text).toContain('[tools]')
    expect(r.text).toContain(MISE_QCTL_TOOL_LINE)
    const again = ensureMiseToml(r.text)
    expect(again.changed).toBe(false)
  })

  test('ensureGitignore adds required patterns', () => {
    const r = ensureGitignore('# only\n')
    expect(r.changed).toBe(true)
    for (const line of GITIGNORE_REQUIRED) {
      expect(r.text).toContain(line)
    }
  })

  test('ensureRootEnvSchema appends stub when QCTL_ENV missing', () => {
    const r = ensureRootEnvSchema('# header\n')
    expect(r.text).toContain('QCTL_ENV=dev')
    expect(r.text).toContain('APP_ROOT=')
  })
})

describe('writeLayout', () => {
  test('greenfield writes layout files and trees', () => {
    const root = join(makeTempDir(), 'demo')
    temps.push(join(root, '..'))
    const report = writeLayout(root, { name: 'demo-lab' })
    expect(report.written).toContain('mise.toml')
    expect(report.written).toContain('package.json')
    expect(report.written).toContain('.gitignore')
    expect(report.written).toContain('.env.schema')
    expect(report.written).toContain('.env.dev')
    expect(report.written).toContain('applications/.gitkeep')
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name).toBe('demo-lab')
    expect(readFileSync(join(root, 'mise.toml'), 'utf8')).toContain(MISE_QCTL_TOOL_LINE)
  })

  test('ensure mode patches missing gitignore/mise lines without clobbering', () => {
    const root = makeTempDir()
    temps.push(root)
    writeFileSync(join(root, '.gitignore'), '# custom\n', 'utf8')
    writeFileSync(join(root, 'mise.toml'), '# custom mise\n', 'utf8')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'keep-me', private: true, type: 'module', dependencies: {} }, null, 2)
        + '\n',
      'utf8',
    )
    writeFileSync(join(root, '.env.schema'), '# @public\nQCTL_ENV=dev\n', 'utf8')
    writeFileSync(join(root, '.env.dev'), 'ENV=dev\n', 'utf8')
    mkdirSync(join(root, 'applications'), { recursive: true })
    writeFileSync(join(root, 'applications', '.gitkeep'), '', 'utf8')

    const report = writeLayout(root, { name: 'keep-me' })
    expect(report.patched).toContain('.gitignore')
    expect(report.patched).toContain('mise.toml')
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('# custom')
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('node_modules/')
    expect(readFileSync(join(root, 'mise.toml'), 'utf8')).toContain('# custom mise')
    expect(readFileSync(join(root, 'mise.toml'), 'utf8')).toContain(MISE_QCTL_TOOL_LINE)
    expect(report.skipped).toContain('package.json')
    expect(report.written).toContain('.env.prod')
    expect(report.written).toContain('common/.gitkeep')
    expect(existsSync(join(root, 'networks', '.gitkeep'))).toBe(true)
  })

  test('dryRun does not touch disk', () => {
    const root = join(makeTempDir(), 'dry')
    temps.push(join(root, '..'))
    mkdirSync(root, { recursive: true })
    const report = writeLayout(root, { dryRun: true, name: 'dry' })
    expect(report.written.length).toBeGreaterThan(0)
    expect(existsSync(join(root, 'mise.toml'))).toBe(false)
  })
})
