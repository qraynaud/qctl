import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { packagesMapWithRequired } from '@qctl/shared'
import { makeTempDir } from '@qctl/shared/test-helpers'

import { createContext } from './context.js'
import { StageError, UnknownStageError } from './errors.js'
import { runStage } from './run-stage.js'
import { ALL_STAGES } from './stages.js'
import { describe, expect, test } from 'bun:test'

/** @import { PlatformModule } from '@qctl/shared' */
/** @import { StageContext } from './context.js' */

/** Minimal platform stub so networking stages can plan without loading the mjs. */
/** @type {PlatformModule} */
const stubPlatform = {
  id: 'test',
  packages: packagesMapWithRequired(),
  installPackages: async () => {},
  networking: {
    planEnsureUp: () => ['ping; nmcli/dhclient'],
    ensureUp: async () => {},
    planApplyDnat: () => ['DNAT from /usr/local/lib/rocky/ports.json (firewalld → 127.0.0.1)'],
    applyDnat: async () => {},
  },
}

/**
 * @param {Partial<StageContext>} [over]
 */
function testCtx(over = {}) {
  /** @type {string[]} */
  const logs = []
  /** @type {string[][]} */
  const execs = []
  const ctx = createContext({
    log: (l) => logs.push(l),
    isRoot: () => true,
    runBash: async () => 0,
    exec: async (argv) => {
      execs.push(argv)
      return { code: 0, stdout: 'abc123+\n', stderr: '' }
    },
    env: {},
    platform: stubPlatform,
    ...over,
  })
  return { ctx, logs, execs }
}

describe('StageError', () => {
  test('flattens multi-line messages for serial console', () => {
    const err = new StageError(
      'tank-create',
      'invalid schema values in /bootstrap:\n  TANK_PASSPHRASE: bw not found',
    )
    expect(err.message).toBe(
      'stage tank-create: invalid schema values in /bootstrap: | TANK_PASSPHRASE: bw not found',
    )
  })
})

describe('runStage', () => {
  test('unknown stage throws UnknownStageError', async () => {
    const { ctx } = testCtx()
    await expect(runStage('nope', ctx)).rejects.toBeInstanceOf(UnknownStageError)
  })

  test('dry-run never executes anything, for every stage', async () => {
    for (const name of ALL_STAGES) {
      const { ctx, logs, execs } = testCtx({ dryRun: true, isRoot: () => false })
      await runStage(name, ctx)
      expect(execs).toEqual([])
      expect(logs[0]).toContain(`dry-run: stage ${name}`)
      expect(logs.length).toBeGreaterThan(1)
    }
  })

  test('host-baseline dry-run plan covers timezone baseline', async () => {
    const { ctx, logs } = testCtx({ dryRun: true })
    await runStage('host-baseline', ctx)
    expect(logs.some((l) => /timedatectl|timezone/i.test(l))).toBe(true)
  })

  test('data-mounts dry-run mentions disks.json + mkfs policy', async () => {
    const { ctx, logs } = testCtx({ dryRun: true })
    await runStage('data-mounts', ctx)
    expect(logs.some((l) => /disks\.json/i.test(l))).toBe(true)
    expect(logs.some((l) => /mkfs|mount only/i.test(l))).toBe(true)
  })

  test('start-services dry-run mentions ports.json DNAT', async () => {
    const { ctx, logs } = testCtx({ dryRun: true })
    await runStage('start-services', ctx)
    expect(logs.some((l) => l.includes('/usr/local/lib/rocky/ports.json'))).toBe(true)
    expect(logs.join('\n')).not.toContain('{%')
  })

  test('tank stages are native JS (dry-run plan)', async () => {
    for (const name of ['tank-import', 'zfs-drill', 'tank-create']) {
      const { ctx, logs, execs } = testCtx({ dryRun: true })
      await runStage(name, ctx)
      expect(execs).toEqual([])
      expect(logs[0]).toContain(`dry-run: stage ${name}`)
      expect(logs.some((l) => /tank|bootstrap|TANK|skipped/i.test(l))).toBe(true)
    }
  })
})

describe('ready-stamp', () => {
  test('writes stamp into overridden dir', async () => {
    const dir = makeTempDir('qctl-stamp-')
    /** @type {string[][]} */
    const execs = []
    const { ctx, logs } = testCtx({
      env: { QCTL_STAMP_DIR: join(dir, 'state'), QCTL_REPO_DIR: '/tmp/repo', QCTL_HG_BIN: '/x/hg' },
      exec: async (argv) => {
        execs.push(argv)
        return { code: 0, stdout: 'deadbeef+\n', stderr: '' }
      },
    })
    await runStage('ready-stamp', ctx)
    const file = join(dir, 'state', 'first-boot.done')
    const body = await readFile(file, 'utf8')
    expect(body.split('\n')[0]).toBe('ok')
    expect(body).toContain('hg_id=deadbeef+')
    expect(body).toContain('tank=imported')
    expect(body).toContain('vw=mounted')
    expect(body).toMatch(/finished_at=\d{4}-/)
    expect((await stat(file)).mode & 0o777).toBe(0o644)
    expect(execs).toEqual([['/x/hg', '-R', '/tmp/repo', 'id', '-i']])
    expect(logs.join('\n')).toContain('first-boot complete')
  })

  test('ROCKY_STAMP_* still honoured (cloud-init baked names)', async () => {
    const dir = makeTempDir('qctl-stamp-')
    const file = join(dir, 'custom.done')
    const { ctx } = testCtx({ env: { ROCKY_STAMP_DIR: dir, ROCKY_STAMP_FILE: file } })
    await runStage('ready-stamp', ctx)
    expect((await readFile(file, 'utf8')).startsWith('ok\n')).toBe(true)
  })

  test('fails without writing when hg id fails', async () => {
    const dir = makeTempDir('qctl-stamp-')
    const { ctx } = testCtx({
      env: { QCTL_STAMP_DIR: dir },
      exec: async () => ({ code: 255, stdout: '', stderr: 'abort: no repo' }),
    })
    await expect(runStage('ready-stamp', ctx)).rejects.toThrow(/hg id failed/)
    expect(await stat(join(dir, 'first-boot.done')).catch(() => null)).toBeNull()
  })

  test('requires root', async () => {
    const { ctx } = testCtx({ isRoot: () => false })
    await expect(runStage('ready-stamp', ctx)).rejects.toThrow(/must run as root/)
  })
})

describe('real bash spawn', () => {
  test('runBash propagates exit code and env', async () => {
    const ctx = createContext({ env: { PATH: process.env.PATH, FOO: 'bar' }, log: () => {} })
    expect(await ctx.runBash('[[ "$FOO" == bar ]] && [[ "$0" == lbl ]]', 'lbl')).toBe(0)
    expect(await ctx.runBash('exit 7', 'lbl')).toBe(7)
  })
})
