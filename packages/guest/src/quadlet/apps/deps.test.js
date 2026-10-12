import { join } from 'node:path'

import { writeFile } from '../../../../shared/src/test-helpers.js'
import { cleanupQuadletFixture, makeQuadletInstance } from '../test/fixture.js'
import { depApps, expandUnitDepApps, topoSortApps, unitDepApps } from './deps.js'
import { companionApps } from './discovery.js'
import { describe, expect, test } from 'bun:test'

describe('deps', () => {
  test('unit deps from After=/Requires= *.service; companions from app.yaml', () => {
    const fx = makeQuadletInstance()
    try {
      const ctx = { root: fx.root }
      const web = join(fx.root, 'applications/web')
      expect(unitDepApps(ctx, web)).toEqual(['proxy']) // network-online ignored (not an app)
      expect(companionApps(web)).toEqual(['dbroot'])
      expect(depApps(ctx, web)).toEqual(['dbroot', 'proxy'])
      expect(expandUnitDepApps(ctx, 'web').sort()).toEqual(['dbroot', 'proxy'])
      expect(expandUnitDepApps(ctx, 'proxy')).toEqual([])
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('transitive expansion never includes the app itself', () => {
    const fx = makeQuadletInstance()
    try {
      writeFile(fx.root, 'applications/proxy/app.yaml', 'engine: rootless\ncompanions:\n  - web\n')
      expect(expandUnitDepApps({ root: fx.root }, 'web')).not.toContain('web')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('topoSort: deps first, ties sorted; cycle dies', () => {
    const fx = makeQuadletInstance()
    try {
      const ctx = { root: fx.root }
      expect(topoSortApps(ctx, ['web', 'proxy', 'dbroot'])).toEqual(['dbroot', 'proxy', 'web'])
      expect(topoSortApps(ctx, ['web', 'proxy'])).toEqual(['proxy', 'web'])
      expect(topoSortApps(ctx, [])).toEqual([])
      // proxy now depends on web via companions → cycle with web→proxy
      writeFile(fx.root, 'applications/proxy/app.yaml', 'engine: rootless\ncompanions:\n  - web\n')
      expect(() => topoSortApps(ctx, ['web', 'proxy'])).toThrow(/cycle/)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
