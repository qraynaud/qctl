import { join } from 'node:path'

import { writeFile } from '@qctl/shared/test-helpers'

import { cleanupQuadletFixture, makeQuadletInstance } from '../test/fixture.js'
import { UNIT_DEP_KEYS, qctlAppProxyUnit, serviceTokenToApp } from './dep-keys.js'
import { rewritePeerServiceDeps } from './rewrite.js'
import { describe, expect, test } from 'bun:test'

describe('rewritePeerServiceDeps', () => {
  test('serviceTokenToApp accepts bare and qctl-app@ forms', () => {
    expect(serviceTokenToApp('web.service')).toBe('web')
    expect(serviceTokenToApp('qctl-app@web.service')).toBe('web')
    expect(serviceTokenToApp('network-online.target')).toBe(null)
    expect(qctlAppProxyUnit('web')).toBe('qctl-app@web.service')
  })

  test('rewrites only cross-engine peers; leaves same-engine and targets', () => {
    const fx = makeQuadletInstance()
    try {
      const ctx = { root: fx.root }
      // web + proxy are rootless; dbroot is rootful
      const src = [
        '[Unit]',
        'After=network-online.target proxy.service dbroot.service',
        'Requires=proxy.service',
        'PropagatesStopTo=dbroot.service',
        'Wants=ghost.service',
        '[Container]',
        'Image=x',
        '',
      ].join('\n')
      const out = rewritePeerServiceDeps(src, ctx, 'rootless')
      expect(out).toContain('After=network-online.target proxy.service qctl-app@dbroot.service')
      expect(out).toContain('Requires=proxy.service')
      expect(out).toContain('PropagatesStopTo=qctl-app@dbroot.service')
      expect(out).toContain('Wants=ghost.service')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('rewrites every UNIT_DEP_KEYS line for a cross-engine peer', () => {
    const fx = makeQuadletInstance()
    try {
      const ctx = { root: fx.root }
      const src = `${UNIT_DEP_KEYS.map((k) => `${k}=dbroot.service`).join('\n')}\n`
      const out = rewritePeerServiceDeps(src, ctx, 'rootless')
      for (const k of UNIT_DEP_KEYS) {
        expect(out).toContain(`${k}=qctl-app@dbroot.service`)
        expect(out).not.toContain(`${k}=dbroot.service`)
      }
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('rootful dependent rewrites rootless peers', () => {
    const fx = makeQuadletInstance()
    try {
      const ctx = { root: fx.root }
      const out = rewritePeerServiceDeps('After=proxy.service dbroot.service\n', ctx, 'rootful')
      expect(out).toBe('After=qctl-app@proxy.service dbroot.service\n')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('idempotent on already-rewritten tokens', () => {
    const fx = makeQuadletInstance()
    try {
      const ctx = { root: fx.root }
      const once = rewritePeerServiceDeps('After=qctl-app@dbroot.service\n', ctx, 'rootless')
      expect(once).toBe('After=qctl-app@dbroot.service\n')
      expect(rewritePeerServiceDeps(once, ctx, 'rootless')).toBe(once)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('preserves trailing comments', () => {
    const fx = makeQuadletInstance()
    try {
      const ctx = { root: fx.root }
      const out = rewritePeerServiceDeps('Requires=dbroot.service  # peer\n', ctx, 'rootless')
      expect(out).toBe('Requires=qctl-app@dbroot.service  # peer\n')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})

describe('unitDepApps + rewritten forms', () => {
  test('discovers peers from PropagatesStopTo and qctl-app@ tokens', async () => {
    const { unitDepApps } = await import('./discovery.js')
    const fx = makeQuadletInstance()
    try {
      writeFile(
        fx.root,
        'applications/web/web/extra.container',
        '[Unit]\nPropagatesStopTo=qctl-app@dbroot.service\n[Container]\nImage=x\n',
      )
      const web = join(fx.root, 'applications/web')
      expect(unitDepApps({ root: fx.root }, web).sort()).toEqual(['dbroot', 'proxy'])
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
