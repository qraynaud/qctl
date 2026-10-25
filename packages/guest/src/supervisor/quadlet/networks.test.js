import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  appNetworkRefs,
  appUsesNetworks,
  listSharedNetworkFiles,
  networkPodmanName,
  networkRefsFromFile,
  networkSharedEngine,
  networkUnitGet,
  networkUnitParent,
  networksSrc,
  sharedNetworkFile,
} from './networks.js'
import { cleanupQuadletFixture, makeQuadletInstance } from './test/fixture.js'
import { describe, expect, test } from 'bun:test'

describe('network helpers', () => {
  test('engine classification, [Network] keys, parent, names', () => {
    const fx = makeQuadletInstance()
    try {
      const lan = join(fx.root, 'networks/lan/lan.network')
      const shared = join(fx.root, 'networks/shared/shared.network')
      expect(networkSharedEngine(lan)).toBe('rootful')
      expect(networkSharedEngine(shared)).toBe('rootless')
      expect(networkUnitGet(shared, 'Subnet')).toBe('10.0.0.0/24')
      expect(networkUnitParent(lan)).toBe('${LAN_PARENT}')
      expect(networkPodmanName(shared)).toBe('shared')
      writeFileSync(shared, '[Network]\nNetworkName=other\n')
      expect(networkPodmanName(shared)).toBe('other')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('networksSrc / listSharedNetworkFiles / sharedNetworkFile', () => {
    const fx = makeQuadletInstance()
    try {
      expect(networksSrc({ root: fx.root })).toBe(join(fx.root, 'networks'))
      expect(networksSrc({ root: fx.sysDir })).toBeNull()

      const listed = listSharedNetworkFiles({ root: fx.root })
      expect(listed.map((f) => f.slice(fx.root.length + 1))).toEqual([
        'networks/lan/lan.network',
        'networks/shared/shared.network',
      ])
      expect(sharedNetworkFile({ root: fx.root }, 'shared.network')).toBe(
        join(fx.root, 'networks/shared/shared.network'),
      )
      expect(sharedNetworkFile({ root: fx.root }, 'shared')).toBe(
        join(fx.root, 'networks/shared/shared.network'),
      )
      expect(sharedNetworkFile({ root: fx.root }, 'nope.network')).toBeNull()
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('networkRefsFromFile / appNetworkRefs / appUsesNetworks', () => {
    const fx = makeQuadletInstance()
    try {
      const proxyUnit = join(fx.root, 'applications/proxy/proxy/proxy.container')
      expect(networkRefsFromFile(proxyUnit)).toEqual(['shared.network'])
      expect(appNetworkRefs(join(fx.root, 'applications/proxy'))).toEqual(['shared.network'])
      expect(appUsesNetworks(join(fx.root, 'applications/proxy'), ['shared.network'])).toBe(true)
      // stem dirty matches only when the unit ref omits .network; fixture uses shared.network
      expect(appUsesNetworks(join(fx.root, 'applications/proxy'), ['shared'])).toBe(false)
      expect(appUsesNetworks(join(fx.root, 'applications/proxy'), ['lan.network'])).toBe(false)
      expect(appUsesNetworks(join(fx.root, 'applications/proxy'), [])).toBe(false)

      mkdirSync(join(fx.root, 'applications/multi'), { recursive: true })
      writeFileSync(join(fx.root, 'applications/multi/app.yaml'), 'engine: rootless\n')
      writeFileSync(
        join(fx.root, 'applications/multi/a.container'),
        '[Container]\nNetwork=a.network:ip=1.2.3.4, b.network\n',
      )
      expect(networkRefsFromFile(join(fx.root, 'applications/multi/a.container')).sort()).toEqual([
        'a.network',
        'b.network',
      ])
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
