import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { QuadletError } from '../errors.js'
import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from '../test/fixture.js'
import { MARKER_DIR } from './constants.js'
import { markEnabled, markerDir, markerEngine, resolveAppEngine, unmarkEnabled } from './markers.js'
import { describe, expect, test } from 'bun:test'

describe('app markers', () => {
  test('markerDir / markEnabled / markerEngine / unmarkEnabled', () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      const paths = sys.paths('rootless')
      expect(markerDir(paths.dest)).toBe(join(paths.dest, MARKER_DIR))

      markEnabled(ctx, 'web', paths)
      const marker = join(paths.dest, MARKER_DIR, 'web')
      expect(existsSync(marker)).toBe(true)
      expect(readFileSync(marker, 'utf8')).toContain('engine=rootless')
      expect(markerEngine(marker)).toBe('rootless')

      unmarkEnabled('web', paths.dest)
      expect(existsSync(marker)).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('resolveAppEngine: marker first, else app.yaml; unknown dies', () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      expect(resolveAppEngine(ctx, 'dbroot').engine).toBe('rootful')
      expect(resolveAppEngine(ctx, 'proxy').engine).toBe('rootless')

      markEnabled(ctx, 'proxy', sys.paths('rootful'))
      expect(resolveAppEngine(ctx, 'proxy').engine).toBe('rootful')

      expect(() => resolveAppEngine(ctx, 'ghost')).toThrow(QuadletError)
      expect(() => resolveAppEngine(ctx, 'ghost')).toThrow(/not installed and not in applications/)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('markerEngine returns empty when no engine= line', () => {
    const fx = makeQuadletInstance()
    try {
      const { sys } = makeContext(fx)
      const f = join(markerDir(sys.paths('rootless').dest), 'x')
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, '# no engine\n')
      expect(markerEngine(f)).toBe('')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
