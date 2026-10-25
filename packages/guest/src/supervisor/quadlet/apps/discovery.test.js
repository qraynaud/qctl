import { join } from 'node:path'

import { writeFile } from '@qctl/shared/test-helpers'

import { QuadletError } from '../errors.js'
import { cleanupQuadletFixture, makeQuadletInstance } from '../test/fixture.js'
import {
  appDir,
  appHasUnits,
  appServiceNames,
  companionApps,
  containerName,
  globExts,
  listRepoApps,
  listUnitDirs,
  packageUnitFiles,
  readEngine,
  resolveAppName,
  unitInstallName,
  unitValue,
} from './discovery.js'
import { describe, expect, test } from 'bun:test'

describe('app discovery', () => {
  test('list/appDir/engine/has units', () => {
    const fx = makeQuadletInstance()
    try {
      const ctx = { root: fx.root }
      expect(listRepoApps(ctx)).toEqual(['dbroot', 'proxy', 'web'])
      expect(appDir(ctx, 'web')).toBe(join(fx.root, 'applications/web'))
      expect(appDir(ctx, 'nope')).toBeNull()
      expect(readEngine(join(fx.root, 'applications/dbroot'))).toBe('rootful')
      expect(appHasUnits(join(fx.root, 'applications/web'))).toBe(true)
      writeFile(fx.root, 'applications/empty/app.yaml', 'engine: rootless\n')
      expect(appHasUnits(join(fx.root, 'applications/empty'))).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('bad / missing engine dies', () => {
    const fx = makeQuadletInstance()
    try {
      writeFile(fx.root, 'applications/bad/app.yaml', 'engine: weird\n')
      writeFile(fx.root, 'applications/none/app.yaml', 'description: x\n')
      expect(() => readEngine(join(fx.root, 'applications/bad'))).toThrow(QuadletError)
      expect(() => readEngine(join(fx.root, 'applications/none'))).toThrow(/missing engine/)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('resolveAppName', () => {
    expect(resolveAppName('caddy')).toBe('caddy')
    expect(resolveAppName('applications/caddy/')).toBe('caddy')
    expect(resolveAppName('/x/applications/caddy')).toBe('caddy')
    expect(() => resolveAppName('common/pg')).toThrow(/libraries/)
    expect(() => resolveAppName('/r/common/pg')).toThrow(/libraries/)
  })

  test('globExts / packageUnitFiles / listUnitDirs / unitInstallName', () => {
    const fx = makeQuadletInstance()
    try {
      const d = join(fx.root, 'applications/web')
      expect(globExts(d, ['container', 'network']).map((f) => f.slice(d.length + 1))).toEqual([
        'web.network',
      ])
      expect(listUnitDirs(d).map((f) => f.slice(d.length + 1))).toEqual(['web'])
      expect(unitInstallName(join(d, 'web'))).toBe('web')
      expect(
        packageUnitFiles(d, ['container', 'network']).map((f) => f.slice(d.length + 1)),
      ).toEqual(['web.network', 'web/web.container'])
      expect(globExts(join(fx.root, 'nope'), ['container'])).toEqual([])
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('service names, ContainerName, Image', () => {
    const fx = makeQuadletInstance()
    try {
      const web = join(fx.root, 'applications/web')
      writeFile(fx.root, 'applications/web/job.timer', '[Timer]\n')
      writeFile(fx.root, 'applications/web/job.service', '[Service]\n')
      expect(appServiceNames(web)).toEqual(['web.service', 'job.timer', 'job.service'])
      expect(containerName(join(web, 'web/web.container'))).toBe('web')
      writeFile(fx.root, 'applications/web/x/x.container', '[Container]\nImage=i\n')
      expect(containerName(join(web, 'x/x.container'))).toBe('x')
      expect(unitValue(join(web, 'web/web.container'), 'Image')).toBe('img/web:${VERSION}')
      expect(companionApps(web)).toEqual(['dbroot'])
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
