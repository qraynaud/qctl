import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '../../../shared/src/test-helpers.js'
import { capabilitiesForProfile } from './capabilities.js'
import { PLATFORM_MODULE_NAME } from './platform.js'
import { runInit } from './run.js'
import { describe, expect, test } from 'bun:test'

const ROOT = join(import.meta.dir, '../../../..')

const DEFAULT = ['network-up', 'host-baseline', 'ready-stamp']
const INIT_TANK = ['tier0-seal', 'vw-mount', 'tank-create', 'poweroff']

/** Capability keys guest profiles may request (fake platform map). */
const FAKE_CAPS = [
  ...capabilitiesForProfile('default', { vcs: 'git' }),
  ...capabilitiesForProfile('init-tank'),
]

/**
 * @param {string} dir
 */
function writeFakePlatformModule(dir) {
  const packages = Object.fromEntries([...new Set(FAKE_CAPS)].map((c) => [c, { distro: [c] }]))
  writeFileSync(
    join(dir, PLATFORM_MODULE_NAME),
    `export const platform = {
  id: 'fake',
  packages: ${JSON.stringify(packages)},
  async installPackages() {},
  networking: {
    planEnsureUp: () => [],
    ensureUp: async () => {},
    planApplyDnat: () => [],
    applyDnat: async () => {},
  },
}
export default platform
`,
  )
}

/** Fake platform for runInit (skipPackages still loads the module for networking). */
const fakePlatform = {
  id: 'fake',
  packages: Object.fromEntries([...new Set(FAKE_CAPS)].map((c) => [c, { distro: [c] }])),
  installPackages: async () => {},
  networking: {
    planEnsureUp: () => [],
    ensureUp: async () => {},
    planApplyDnat: () => [],
    applyDnat: async () => {},
  },
}

/**
 * @param {Partial<Parameters<typeof runInit>[1]> & { failAt?: string }} [over]
 */
function harness(over = {}) {
  /** @type {string[]} */
  const out = []
  /** @type {string[]} */
  const err = []
  /** @type {string[]} */
  const ran = []
  const deps = {
    skipPackages: true,
    loadPlatform: async () => fakePlatform,
    log: (/** @type {string} */ l) => out.push(l),
    logError: (/** @type {string} */ l) => err.push(l),
    runStage: async (/** @type {string} */ name) => {
      ran.push(name)
      if (name === over.failAt) throw new Error(`boom ${name}`)
    },
    ...over,
  }
  // Replace stagesForProfile by mocking runStage only — use real stage lists via profile.
  return { deps, out, err, ran }
}

describe('runInit', () => {
  test('runs stages in order with `== stage` logs', async () => {
    const h = harness()
    // Override profile stages by failing the real stagesForProfile — inject via runStage only.
    // Use real DEFAULT_STAGES from stages.js by not mocking list.
    const code = await runInit(
      { profile: 'default' },
      {
        ...h.deps,
        runStage: async (name) => {
          if (!DEFAULT.includes(name) && name !== 'tier0-seal') {
            // still run full default list from stages.js
          }
          h.ran.push(name)
          if (name === h.deps.failAt) throw new Error('boom')
        },
      },
    )
    // Real default profile has many stages — just check first/last and exit 0
    expect(code).toBe(0)
    expect(h.out.filter((l) => l.startsWith('== ')).length).toBeGreaterThan(5)
    expect(h.out[0]).toContain('profile=default')
    expect(h.ran[0]).toBe('network-up')
    expect(h.ran.at(-1)).toBe('ready-stamp')
  })

  test('init-tank profile uses its own list', async () => {
    /** @type {string[]} */
    const ran = []
    expect(
      await runInit(
        { profile: 'init-tank' },
        {
          skipPackages: true,
          loadPlatform: async () => fakePlatform,
          runStage: async (name) => {
            ran.push(name)
          },
        },
      ),
    ).toBe(0)
    expect(ran).toEqual(INIT_TANK)
  })

  test('--dry-run sets dryRun on context', async () => {
    /** @type {boolean[]} */
    const flags = []
    expect(
      await runInit(
        { profile: 'init-tank', dryRun: true },
        {
          skipPackages: true,
          loadPlatform: async () => fakePlatform,
          runStage: async (_name, ctx) => {
            flags.push(Boolean(ctx.dryRun))
          },
        },
      ),
    ).toBe(0)
    expect(flags.every(Boolean)).toBe(true)
  })

  test('first failure stops', async () => {
    /** @type {string[]} */
    const ran = []
    /** @type {string[]} */
    const err = []
    expect(
      await runInit(
        { profile: 'default' },
        {
          skipPackages: true,
          loadPlatform: async () => fakePlatform,
          logError: (l) => err.push(l),
          runStage: async (name) => {
            ran.push(name)
            if (name === 'host-baseline') throw new Error('boom')
          },
        },
      ),
    ).toBe(1)
    expect(ran).toEqual(['network-up', 'host-baseline'])
    expect(err.join('\n')).toMatch(/host-baseline/)
  })

  test('--from resumes at a stage; unknown --from fails', async () => {
    /** @type {string[]} */
    const ran = []
    expect(
      await runInit(
        { profile: 'init-tank', from: 'tank-create' },
        {
          skipPackages: true,
          loadPlatform: async () => fakePlatform,
          runStage: async (name) => {
            ran.push(name)
          },
        },
      ),
    ).toBe(0)
    expect(ran).toEqual(['tank-create', 'poweroff'])

    /** @type {string[]} */
    const err = []
    expect(
      await runInit(
        { profile: 'init-tank', from: 'nope' },
        {
          skipPackages: true,
          loadPlatform: async () => fakePlatform,
          logError: (l) => err.push(l),
        },
      ),
    ).toBe(1)
    expect(err.join('\n')).toMatch(/--from nope/)
  })
})

describe('qctl init (CLI)', () => {
  /**
   * @param {string[]} args
   * @param {Record<string, string>} env
   */
  async function runGuest(args, env) {
    const proc = Bun.spawn(
      [process.execPath, 'run', join(ROOT, 'packages/guest/src/cli.js'), ...args],
      {
        cwd: '/',
        env: { ...process.env, ...env },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout, stderr, code }
  }

  test('--dry-run init-tank without platform module still fails packages unless module staged', async () => {
    const dir = makeTempDir()
    try {
      writeFakePlatformModule(dir)
      const r = await runGuest(['init', '--profile', 'init-tank', '--dry-run'], {
        QCTL_PLATFORM_MODULE: join(dir, PLATFORM_MODULE_NAME),
      })
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('== vw-mount')
      expect(r.stdout).toContain('== poweroff')
      expect(r.stdout).toContain('(dry-run)')
    } finally {
      removeTempDir(dir)
    }
  })

  test('missing platform module → exit 1', async () => {
    const r = await runGuest(['init', '--dry-run'], {
      QCTL_PLATFORM_MODULE: '/nonexistent/qctl-platform-rocky.mjs',
      QCTL_LIB_DIR: '/nonexistent-lib',
    })
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/QCTL_PLATFORM_MODULE|qctl-platform-rocky\.mjs/)
  })

  test('init --help documents profile / dry-run / from / module', async () => {
    const r = await runGuest(['init', '--help'], {})
    expect(r.code).toBe(0)
    for (const f of ['--profile', '--dry-run', '--from', 'init-tank', 'QCTL_PLATFORM_MODULE']) {
      expect(r.stdout).toContain(f)
    }
  })

  test('list --profile init-tank', async () => {
    const r = await runGuest(['list', '--profile', 'init-tank'], {})
    expect(r.code).toBe(0)
    expect(r.stdout.trim().split('\n')).toEqual(INIT_TANK)
  })
})
