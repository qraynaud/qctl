import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import * as mod from './init.js'
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

describe('init command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('init [dir]')
    expect(mod.describe).toMatch(/Quickstart|ensure|check/i)
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('builder exposes mode flags', () => {
    /** @type {string[]} */
    const options = []
    const yargs = {
      positional() {
        return yargs
      },
      /** @param {string} name */
      option(name) {
        options.push(String(name))
        return yargs
      },
      epilog() {
        return yargs
      },
    }
    mod.builder(/** @type {never} */ (yargs))
    expect(options).toContain('yes')
    expect(options).toContain('force')
    expect(options).toContain('fix')
    expect(options).toContain('check')
    expect(options).toContain('dry-run')
    expect(options).toContain('profile')
    expect(options).toContain('sync-env-from-yaml')
    expect(options).toContain('no-init-tank')
    expect(options).toContain('no-ai-skills')
  })

  test('--yes writes Quickstart lab and prints outro', async () => {
    const root = join(makeTempDir(), 'demo')
    temps.push(join(root, '..'))
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })
    await mod.handler({
      dir: root,
      yes: true,
      force: true,
      noInitTank: true,
      name: 'demo-lab',
    })
    expect(process.exitCode ?? 0).toBe(0)
    expect(existsSync(join(root, 'provision', 'common.yaml'))).toBe(true)
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('"demo-lab"')

    const common = readFileSync(join(root, 'provision', 'common.yaml'), 'utf8')
    expect(common).toMatch(/lab:\s*\n\s*env:\s*dev/)
    expect(common).toMatch(/target:\s*workstation/)
    expect(common).not.toMatch(/proxmox:\s*$/m)

    const envDev = readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')
    expect(envDev).toMatch(/size:\s*\d/)
    expect(envDev).not.toMatch(/SET_PHYSICAL_DISK_ID/)
    expect(envDev).toContain('passphrase: lab-tank-passphrase')

    const ws = readFileSync(join(root, 'provision', 'target-workstation.yaml'), 'utf8')
    expect(ws).toMatch(/cpu:\s*2/)
    expect(ws).toMatch(/memory:\s*4096/)

    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(root, '.cursor', 'skills', 'qctl-provision', 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('qctl-provision')

    expect(lines.some((l) => l.includes('initialized'))).toBe(true)
    expect(lines.some((l) => l.includes('qctl vm shell'))).toBe(true)
    expect(lines.some((l) => l.includes('qctl new profile'))).toBe(true)
  })

  test('--yes --no-ai-skills skips AGENTS.md and skill scaffold', async () => {
    const root = join(makeTempDir(), 'noai')
    temps.push(join(root, '..'))
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({
      dir: root,
      yes: true,
      force: true,
      noInitTank: true,
      noAiSkills: true,
      name: 'noai',
    })
    expect(process.exitCode ?? 0).toBe(0)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
    expect(existsSync(join(root, '.cursor', 'skills', 'qctl-provision', 'SKILL.md'))).toBe(false)
    expect(existsSync(join(root, 'provision', 'common.yaml'))).toBe(true)
  })

  test('--dry-run --yes does not create provision tree', async () => {
    const root = join(makeTempDir(), 'dry')
    temps.push(join(root, '..'))
    spyOn(console, 'log').mockImplementation(() => {})
    await mod.handler({ dir: root, yes: true, dryRun: true, force: true })
    expect(process.exitCode ?? 0).toBe(0)
    expect(existsSync(join(root, 'provision'))).toBe(false)
    expect(existsSync(join(root, 'package.json'))).toBe(false)
  })

  test('--fix on non-instance fails', async () => {
    const root = join(makeTempDir(), 'nofix')
    temps.push(join(root, '..'))
    mkdirSync(root, { recursive: true })
    /** @type {string[]} */
    const errs = []
    spyOn(console, 'error').mockImplementation((line) => {
      errs.push(String(line))
    })
    await mod.handler({ dir: root, fix: true })
    expect(process.exitCode).toBe(1)
    expect(errs.some((l) => /--fix/i.test(l))).toBe(true)
  })

  test('existing instance without --force ensures (does not refuse)', async () => {
    const root = join(makeTempDir(), 'exist')
    temps.push(join(root, '..'))
    await mod.handler({ dir: root, yes: true, force: true, noInitTank: true })
    process.exitCode = 0
    // Drop a layout file; ensure should recreate it
    const { unlinkSync } = await import('node:fs')
    unlinkSync(join(root, 'mise.toml'))
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })
    await mod.handler({ dir: root, yes: true, force: false })
    expect(process.exitCode ?? 0).toBe(0)
    expect(existsSync(join(root, 'mise.toml'))).toBe(true)
    expect(lines.some((l) => /ensured missing scaffold|initialized|mise/i.test(l))).toBe(true)
  })

  test('--check on lab instance exits 0', async () => {
    const root = join(makeTempDir(), 'chk')
    temps.push(join(root, '..'))
    await mod.handler({ dir: root, yes: true, force: true, noInitTank: true })
    process.exitCode = 0
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({ dir: root, check: true })
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('--sync-env-from-yaml adds missing schema keys', async () => {
    const root = join(makeTempDir(), 'sync')
    temps.push(join(root, '..'))
    await mod.handler({ dir: root, yes: true, force: true, noInitTank: true })
    process.exitCode = 0
    writeFileSync(
      join(root, 'provision', 'env-dev.yaml'),
      `${readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')}\n# x\nssh:\n  host_keys: !env SYNC_HOST_KEYS\n`,
      'utf8',
    )
    await mod.handler({ dir: root, fix: true, syncEnvFromYaml: true })
    expect(readFileSync(join(root, 'provision', '.env.schema'), 'utf8')).toMatch(/SYNC_HOST_KEYS=/)
  })

  test('--fix does not inject opinionated secret catalog keys', async () => {
    const root = join(makeTempDir(), 'nosec')
    temps.push(join(root, '..'))
    await mod.handler({ dir: root, yes: true, force: true, noInitTank: true })
    process.exitCode = 0
    const schemaPath = join(root, 'provision', '.env.schema')
    writeFileSync(schemaPath, '# ---\n', 'utf8')
    await mod.handler({ dir: root, fix: true })
    const schema = readFileSync(schemaPath, 'utf8')
    expect(schema).not.toMatch(/TANK_PASSPHRASE=/)
    expect(schema).not.toMatch(/DEPLOY_KEY=/)
    expect(schema).not.toMatch(/VW_CLIENT/)
  })

  test('non-TTY without --yes fails with actionable message', async () => {
    const root = join(makeTempDir(), 'notty')
    temps.push(join(root, '..'))
    const prevIn = process.stdin.isTTY
    const prevOut = process.stdout.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    /** @type {string[]} */
    const errs = []
    spyOn(console, 'error').mockImplementation((line) => {
      errs.push(String(line))
    })
    try {
      await mod.handler({ dir: root, yes: false })
      expect(process.exitCode).toBe(1)
      expect(errs.some((l) => /--yes/i.test(l))).toBe(true)
      expect(existsSync(join(root, 'provision'))).toBe(false)
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: prevIn, configurable: true })
      Object.defineProperty(process.stdout, 'isTTY', { value: prevOut, configurable: true })
    }
  })
})
