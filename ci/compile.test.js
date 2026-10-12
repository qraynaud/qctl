import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveNativeHelperBinary } from './compile.js'
import { describe, expect, test } from 'bun:test'

const ROOT = join(import.meta.dir, '..')

describe('ci/compile.js', () => {
  test('script documents known targets and points at .js entries', () => {
    const src = readFileSync(join(ROOT, 'ci/compile.js'), 'utf8')
    expect(src).toContain("id: 'host'")
    expect(src).toContain("id: 'guest'")
    expect(src).toContain("cwd: 'packages/host'")
    expect(src).toContain("cwd: 'packages/guest'")
    expect(src).toContain("entry: 'src/cli.js'")
    expect(src).toContain("'seed'")
    expect(src).toContain('HELPER_NAME')
    expect(src).not.toContain('stageHostCloudImageAsset')
    expect(src).not.toMatch(/assets:\s*\[[^\]]*cloud-image\.json/)
    expect(src).toContain('varlock-local-encrypt')
    expect(src).toContain('qctl-platform-rocky.mjs')
    expect(src).toContain('bundlePlatformModule')
    expect(src).not.toContain("outfile: 'qctl-platform-rocky'")
    expect(src).not.toContain('stageRockySeed')
  })

  test('resolveNativeHelperBinary finds the platform helper when installed', () => {
    const bin = resolveNativeHelperBinary()
    expect(bin).toBeTruthy()
    expect(existsSync(/** @type {string} */ (bin))).toBe(true)
    expect(bin).toMatch(/varlock-local-encrypt/)
  })

  test('unknown target exits non-zero', async () => {
    const proc = Bun.spawn(['bun', 'run', join(ROOT, 'ci/compile.js'), 'nope'], {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
    expect(code).toBe(1)
    expect(stderr).toMatch(/unknown target/)
  })
})
