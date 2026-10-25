import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from '../test/fixture.js'
import {
  createUpSession,
  markRestart,
  markerAlready,
  noteDirtyNetwork,
  noteEngine,
  plan,
  will,
} from './session.js'
import { describe, expect, test } from 'bun:test'

describe('up session', () => {
  test('createUpSession filters + dry flag', () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx } = makeContext(fx)
      const s = createUpSession(ctx, { dryRun: true, apps: ['applications/web', 'proxy'] })
      expect(s.dry).toBe(true)
      expect(s.filtered).toBe(true)
      expect(s.filterList).toEqual(['proxy', 'web'])
      expect(createUpSession(ctx, { app: 'dbroot' }).filterList).toEqual(['dbroot'])
      expect(createUpSession(ctx).filtered).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('will / plan / notes dedupe', () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, out } = makeContext(fx)
      const s = createUpSession(ctx, { dryRun: true })
      will(s, 'add', 'web')
      will(s, 'add', 'proxy')
      expect(s.dryActions).toBe(2)
      plan(s, 'update', 'web')
      plan(s, 'update', 'web')
      expect(s.dryActions).toBe(3)
      expect(out.filter((l) => l.startsWith('will '))).toEqual([
        'will add web',
        'will add proxy',
        'will update web',
      ])

      markRestart(s, 'web')
      markRestart(s, 'web')
      expect(s.restartApps).toEqual(['web'])
      noteEngine(s, 'rootless')
      noteEngine(s, 'rootless')
      noteEngine(s, 'rootful')
      expect(s.reloadEngines).toEqual(['rootless', 'rootful'])
      noteDirtyNetwork(s, 'shared.network')
      noteDirtyNetwork(s, 'shared.network')
      expect(s.dirtyNetworks).toEqual(['shared.network'])

      s.markers.push({ marker: '', app: 'web', engine: 'rootless' })
      expect(markerAlready(s, 'web')).toBe(true)
      expect(markerAlready(s, 'proxy')).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
