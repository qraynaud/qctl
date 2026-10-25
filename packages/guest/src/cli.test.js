import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { makeSecretInstance, makeShims } from './secret/fixture.js'
import { describe, expect, test } from 'bun:test'

const ROOT = join(import.meta.dir, '../../..')

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [opts]
 */
async function runGuest(args, opts = {}) {
  const proc = Bun.spawn(['bun', 'run', join(ROOT, 'packages/guest/src/cli.js'), ...args], {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, code }
}

describe('guest CLI', () => {
  test('--help lists public commands and points at --help-with-internals', async () => {
    const { stdout, code } = await runGuest(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('quadlet')
    expect(stdout).toContain('secret')
    expect(stdout).toContain('--help-with-internals')
    // Internal tooling stays registered but off the default Commands list.
    expect(stdout).not.toMatch(/\bqctl _internal_/)
  })

  test('bare qctl shows public help without documenting --help-with-internals', async () => {
    const { stdout, code } = await runGuest([])
    expect(code).toBe(0)
    expect(stdout).toContain('quadlet')
    expect(stdout).toContain('secret')
    expect(stdout).not.toContain('--help-with-internals')
    expect(stdout).not.toMatch(/\bqctl _internal_/)
    expect(stdout).not.toContain('_internal_')
  })

  test('--help-with-internals lists first-boot / debug commands', async () => {
    const { stdout, code } = await runGuest(['--help-with-internals'])
    expect(code).toBe(0)
    expect(stdout).toContain('_internal_init')
    expect(stdout).toContain('_internal_list')
    expect(stdout).toContain('_internal_stage')
    expect(stdout).toContain('_internal_plugins')
    expect(stdout).toContain('quadlet')
    expect(stdout).toContain('secret')
  })

  test('quadlet --help lists every subcommand', async () => {
    const { stdout, code } = await runGuest(['quadlet', '--help'])
    expect(code).toBe(0)
    for (const c of ['up', 'down', 'enable', 'start', 'stop', 'restart', 'ps']) {
      expect(stdout).toMatch(new RegExp(`qctl quadlet ${c}\\b`))
    }
  })

  test('quadlet up --help documents --dry-run (no --root)', async () => {
    const { stdout, code } = await runGuest(['quadlet', 'up', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('--dry-run')
    expect(stdout).not.toContain('--root')
  })

  test('secret sync --help documents flags', async () => {
    const { stdout, code } = await runGuest(['secret', 'sync', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('--dry-run')
    expect(stdout).toContain('--restart')
  })

  test('secret check --help documents drift flow', async () => {
    const { stdout, code } = await runGuest(['secret', 'check', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('secret sync --restart')
  })

  test('quadlet without OS config fails clearly (no sudo attempt)', async () => {
    const dir = makeTempDir()
    try {
      const { stderr, code } = await runGuest(['quadlet', 'ps'], { cwd: dir })
      expect(code).toBe(1)
      expect(stderr).toMatch(/missing instance root|\/etc\/qctl\/config\.json/)
    } finally {
      removeTempDir(dir)
    }
  })

  test('secret sync without OS config fails clearly', async () => {
    const dir = makeTempDir()
    try {
      const { stderr, code } = await runGuest(['secret', 'sync'], { cwd: dir })
      expect(code).toBe(1)
      expect(stderr).toMatch(/missing OS config|\/etc\/qctl\/config\.json/)
    } finally {
      removeTempDir(dir)
    }
  })

  test('secret sync --help documents --app and ExecStartPre', async () => {
    const { stdout, code } = await runGuest(['secret', 'sync', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('--app')
    expect(stdout).toContain('ExecStartPre=qctl secret sync --app=')
    expect(stdout).not.toContain('sudo')
  })
})

describe('secret sync end-to-end (varlock graph + podman shim)', () => {
  // Library path (supervisor owns day-2 CLI RPC).
  test('creates rootless podman secrets from graph-resolved unit literals', async () => {
    const { runSecretSync } = await import('./secret/sync.js')
    const root = makeSecretInstance()
    const shims = makeShims()
    const prevPath = process.env.PATH
    process.env.PATH = shims.env.PATH
    /** @type {string[]} */
    const logs = []
    try {
      await runSecretSync({
        root,
        uid: 1000,
        env: { ...process.env, ...shims.env },
        log: (m) => logs.push(m),
      })
      expect(logs.some((l) => l.includes('ok rootless secret/CADDY_DNS'))).toBe(true)
      expect(logs.some((l) => l.includes('skip ACTIVE_DIRECTORY_ADMIN_PASSWORD'))).toBe(true)
      expect(readFileSync(join(shims.logDir, 'secret.CADDY_DNS'), 'utf8')).toBe('real-dns-token')
    } finally {
      process.env.PATH = prevPath
      removeTempDir(root)
      removeTempDir(shims.dir)
    }
  })
})
