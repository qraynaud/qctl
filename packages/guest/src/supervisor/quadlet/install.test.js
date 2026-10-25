import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadRenderEnv } from './env.js'
import {
  autostartBody,
  autostartDiffers,
  installIfChanged,
  linkTopLevelNetworks,
  syncAutostart,
  templateDiffers,
  unitInstallDir,
  wantsAutostart,
} from './install.js'
import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from './test/fixture.js'
import { describe, expect, test } from 'bun:test'

describe('install helpers', () => {
  test('unitInstallDir / wantsAutostart / autostartBody', () => {
    const fx = makeQuadletInstance()
    try {
      const { sys } = makeContext(fx)
      const paths = sys.paths('rootless')
      expect(unitInstallDir(paths, join(fx.root, 'applications/web/web'))).toBe(
        join(paths.dest, 'web'),
      )
      expect(wantsAutostart('web.container')).toBe(true)
      expect(wantsAutostart('shared.network')).toBe(false)
      expect(autostartBody('rootless')).toContain('WantedBy=default.target')
      expect(autostartBody('rootful')).toContain('WantedBy=multi-user.target')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('installIfChanged / templateDiffers write only when content changes', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      const paths = sys.paths('rootless')
      const src = join(fx.root, 'applications/proxy/proxy/proxy.container')
      const dest = join(paths.dest, 'proxy/proxy.container')
      const renv = await loadRenderEnv(ctx, join(fx.root, 'applications/proxy'))

      expect(templateDiffers(ctx, src, dest, renv, paths.engine)).toBe(true)
      expect(installIfChanged(ctx, paths, src, dest, renv)).toBe(true)
      expect(existsSync(dest)).toBe(true)
      expect(installIfChanged(ctx, paths, src, dest, renv)).toBe(false)
      expect(templateDiffers(ctx, src, dest, renv, paths.engine)).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('install rewrites only cross-engine peers; same-engine stays peer.service', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      const paths = sys.paths('rootless')
      const src = join(fx.root, 'applications/web/web/web.container')
      // Add a cross-engine dep beside same-engine proxy.
      writeFileSync(
        src,
        `${readFileSync(src, 'utf8').replace(
          'After=network-online.target proxy.service',
          'After=network-online.target proxy.service dbroot.service',
        )}`,
      )
      const dest = join(paths.dest, 'web/web.container')
      const renv = await loadRenderEnv(ctx, join(fx.root, 'applications/web'))
      expect(installIfChanged(ctx, paths, src, dest, renv)).toBe(true)
      const body = readFileSync(dest, 'utf8')
      expect(body).toContain('After=network-online.target proxy.service qctl-app@dbroot.service')
      expect(body).toContain('Requires=proxy.service')
      expect(body).not.toContain('qctl-app@proxy.service')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('syncAutostart create/remove; autostartDiffers', () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      const paths = sys.paths('rootless')
      const unit = join(paths.dest, 'proxy.container')
      mkdirSync(paths.dest, { recursive: true })
      writeFileSync(unit, '[Container]\n')

      expect(autostartDiffers(unit, 'rootless')).toBe(true)
      expect(syncAutostart(ctx, paths, unit, true)).toBe(true)
      expect(readFileSync(`${unit}.d/autostart.conf`, 'utf8')).toContain('default.target')
      expect(syncAutostart(ctx, paths, unit, true)).toBe(false)
      expect(autostartDiffers(unit, 'rootless')).toBe(false)

      expect(syncAutostart(ctx, paths, unit, false)).toBe(true)
      expect(existsSync(`${unit}.d/autostart.conf`)).toBe(false)
      expect(syncAutostart(ctx, paths, 'x.network', true)).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('linkTopLevelNetworks symlinks missing network refs', () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      const paths = sys.paths('rootless')
      mkdirSync(paths.dest, { recursive: true })
      writeFileSync(join(paths.dest, 'shared.network'), '[Network]\n')
      const unitDest = join(paths.dest, 'proxy')
      mkdirSync(unitDest, { recursive: true })

      linkTopLevelNetworks(ctx, paths, unitDest, ['shared.network', 'missing.network'])
      const link = join(unitDest, 'shared.network')
      expect(existsSync(link)).toBe(true)
      expect(readFileSync(link, 'utf8')).toBe('[Network]\n')
      // already linked → no-op
      linkTopLevelNetworks(ctx, paths, unitDest, ['shared'])
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
