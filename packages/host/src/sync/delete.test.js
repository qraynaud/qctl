/**
 * find -prune does not skip files — protected basenames use ! -name.
 * Repo-root `.env` must be deletable (instance uses .env.dev/.env.prod only).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { $ } from 'zx'

import { makeTempDir } from '@qctl/shared/test-helpers'

import { buildRepoArchive, listArchivePaths, remoteDeleteScript } from './repo.js'
import { describe, expect, test } from 'bun:test'

describe('sync --delete', () => {
  test('removes stale files and stray .env; keeps .hg and build.env', async () => {
    const root = makeTempDir('qctl-del-')
    const remote = join(root, 'remote')
    mkdirSync(remote)
    writeFileSync(join(remote, 'README.md'), 'hi\n')
    writeFileSync(join(remote, '.env'), 'STALE=1\n')
    writeFileSync(join(remote, 'build.env'), 'KEEP=1\n')
    writeFileSync(join(remote, 'stale.txt'), 'gone\n')
    mkdirSync(join(remote, '.hg'))
    writeFileSync(join(remote, '.hg', 'requires'), 'x\n')

    const local = join(root, 'local')
    mkdirSync(local)
    writeFileSync(join(local, 'README.md'), 'hi\n')
    const tar = join(root, 'a.tgz')
    await buildRepoArchive(local, tar)
    const man = join(root, 'manifest')
    writeFileSync(man, `${(await listArchivePaths(tar)).join('\n')}\n`)
    const script = join(root, 'del.sh')
    writeFileSync(script, `${remoteDeleteScript()}\n`)

    const r = await $`bash ${script} ${remote} ${man}`.nothrow()
    expect(r.exitCode).toBe(0)
    expect(existsSync(join(remote, 'stale.txt'))).toBe(false)
    expect(existsSync(join(remote, '.env'))).toBe(false)
    expect(existsSync(join(remote, 'build.env'))).toBe(true)
    expect(existsSync(join(remote, '.hg', 'requires'))).toBe(true)
    expect(existsSync(join(remote, 'README.md'))).toBe(true)
  })
})
