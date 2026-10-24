import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { installHttpPackages } from './install-http.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []
/** @type {ReturnType<typeof Bun.serve>[]} */
const servers = []

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()
    s?.stop(true)
  }
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

/**
 * @param {Uint8Array | string} body
 * @param {string} [contentType]
 */
function serveBytes(body, contentType = 'application/octet-stream') {
  const server = Bun.serve({
    port: 0,
    fetch() {
      const payload = typeof body === 'string' ? body : Buffer.from(body)
      return new Response(payload, { headers: { 'content-type': contentType } })
    },
  })
  servers.push(server)
  return `http://127.0.0.1:${server.port}/payload`
}

describe('installHttpPackages', () => {
  test('downloads raw binary with Bun fetch (no curl)', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const dest = join(dir, 'bin', 'tool')
    const url = serveBytes('#!/bin/sh\necho ok\n')
    await installHttpPackages([{ url, dest }], {
      log: () => {},
      env: {},
    })
    expect(await readFile(dest, 'utf8')).toBe('#!/bin/sh\necho ok\n')
  })

  test('extracts zip member named by bin', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const zipPath = join(dir, 'bw.zip')
    const py = Bun.spawn(
      [
        'python3',
        '-c',
        'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("bw","bw-bin\\n"); z.close()',
        zipPath,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    expect(await py.exited).toBe(0)
    const bytes = await Bun.file(zipPath).bytes()
    const url = serveBytes(bytes, 'application/zip')
    const outDir = join(dir, 'out')
    await installHttpPackages([{ url, bin: 'bw' }], {
      log: () => {},
      env: { ROCKY_PACKAGES_BIN_DIR: outDir },
    })
    expect(await readFile(join(outDir, 'bw'), 'utf8')).toBe('bw-bin\n')
  })

  test('runs test with APP set', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const dest = join(dir, 'app')
    const url = serveBytes('payload\n')
    await installHttpPackages(
      [
        {
          url,
          dest,
          test: 'test -x "$APP" && test "$(cat "$APP")" = "payload"',
        },
      ],
      { log: () => {}, env: {} },
    )
    const mode = (await Bun.file(dest).stat()).mode & 0o777
    expect(mode & 0o111).toBeTruthy()
  })
})
