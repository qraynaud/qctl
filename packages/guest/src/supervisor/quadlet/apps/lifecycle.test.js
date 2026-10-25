import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { QuadletError } from '../errors.js'
import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from '../test/fixture.js'
import { MARKER_DIR } from './constants.js'
import { appSystemctl, rmdirQuiet, stopAndRemoveApp } from './lifecycle.js'
import { markEnabled } from './markers.js'
import { describe, expect, test } from 'bun:test'

describe('app lifecycle helpers', () => {
  test('appSystemctl starts each service; unknown / no units die', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys, out } = makeContext(fx)
      const paths = sys.paths('rootless')
      await appSystemctl(ctx, 'start', 'proxy', paths)
      expect(out).toContain('quadlet: start proxy.service (rootless)')
      expect(sys.lines()).toContain('systemctl:rootless start proxy.service')

      await expect(appSystemctl(ctx, 'start', 'ghost', paths)).rejects.toThrow(QuadletError)
      mkdirSync(join(fx.root, 'applications/empty'), { recursive: true })
      writeFileSync(join(fx.root, 'applications/empty/app.yaml'), 'engine: rootless\n')
      await expect(appSystemctl(ctx, 'start', 'empty', paths)).rejects.toThrow(/no startable units/)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('stopAndRemoveApp stops units, removes install tree + marker', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      const paths = sys.paths('rootless')
      mkdirSync(join(paths.dest, 'proxy'), { recursive: true })
      writeFileSync(join(paths.dest, 'proxy/proxy.container'), 'x\n')
      writeFileSync(join(paths.dest, 'proxy.network'), 'n\n')
      markEnabled(ctx, 'proxy', paths)

      await stopAndRemoveApp(ctx, 'proxy', paths)
      expect(sys.lines()).toContain('systemctl:rootless stop proxy.service')
      expect(sys.lines()).toContain('systemctl:rootless disable proxy.service')
      expect(existsSync(join(paths.dest, 'proxy'))).toBe(false)
      expect(existsSync(join(paths.dest, 'proxy.network'))).toBe(false)
      expect(existsSync(join(paths.dest, MARKER_DIR, 'proxy'))).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('rmdirQuiet ignores missing / non-empty dirs', () => {
    const fx = makeQuadletInstance()
    try {
      const empty = join(fx.sysDir, 'empty-dir')
      mkdirSync(empty)
      rmdirQuiet(empty)
      expect(existsSync(empty)).toBe(false)
      rmdirQuiet(join(fx.sysDir, 'missing'))
      const full = join(fx.sysDir, 'full')
      mkdirSync(full)
      writeFileSync(join(full, 'f'), 'x')
      rmdirQuiet(full)
      expect(existsSync(full)).toBe(true)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
