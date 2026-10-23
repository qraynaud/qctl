import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { REQUIRED_INSTANCE_FILES, checkInstance } from './check-instance.js'
import { defaultQuickstartAnswers, writeQuickstartLab } from './quickstart.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('checkInstance', () => {
  test('REQUIRED_INSTANCE_FILES lists core layout', () => {
    expect(REQUIRED_INSTANCE_FILES).toContain('provision/common.yaml')
    expect(REQUIRED_INSTANCE_FILES).toContain('mise.toml')
  })

  test('passes on fresh --yes lab', async () => {
    const root = join(makeTempDir(), 'ok')
    temps.push(join(root, '..'))
    writeQuickstartLab(root, defaultQuickstartAnswers(root), { force: true })
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
    const ok = await checkInstance(root)
    expect(ok).toBe(true)
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('fails when not an instance', async () => {
    const root = join(makeTempDir(), 'empty')
    temps.push(join(root, '..'))
    mkdirSync(root, { recursive: true })
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
    const ok = await checkInstance(root)
    expect(ok).toBe(false)
    expect(process.exitCode).toBe(1)
  })

  test('fails on SET_PHYSICAL_DISK_ID placeholder in provision YAML text', async () => {
    const root = join(makeTempDir(), 'phys')
    temps.push(join(root, '..'))
    writeQuickstartLab(root, defaultQuickstartAnswers(root), { force: true })
    const envPath = join(root, 'provision', 'env-dev.yaml')
    writeFileSync(
      envPath,
      `${readFileSync(envPath, 'utf8')}\n# pending bind: SET_PHYSICAL_DISK_ID_DATA1\n`,
      'utf8',
    )
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
    const ok = await checkInstance(root)
    expect(ok).toBe(false)
  })

  test('warns when deps exist without package-lock.json', async () => {
    const root = join(makeTempDir(), 'lock')
    temps.push(join(root, '..'))
    writeQuickstartLab(root, defaultQuickstartAnswers(root), { force: true })
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify(
        { name: 'lock-lab', private: true, type: 'module', dependencies: { leftpad: '1.0.0' } },
        null,
        2,
      ),
      'utf8',
    )
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })
    spyOn(console, 'error').mockImplementation(() => {})
    const ok = await checkInstance(root)
    expect(ok).toBe(true)
    expect(lines.some((l) => /package-lock\.json is missing/i.test(l))).toBe(true)
  })
})
