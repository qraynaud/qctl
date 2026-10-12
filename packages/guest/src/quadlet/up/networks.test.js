import { writeFile } from '../../../../shared/src/test-helpers.js'
import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from '../test/fixture.js'
import { runUp } from './index.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet up networks', () => {
  test('network change recreates podman network and restarts its consumers', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      writeFile(fx.root, 'networks/shared/shared.network', '[Network]\nSubnet=10.5.0.0/24\n')

      const d = makeContext(fx)
      await runUp(d.ctx, { dryRun: true })
      expect(d.out).toEqual([
        'will update shared.network',
        'will restart proxy',
        'will restart web',
      ])

      const { ctx, sys } = makeContext(fx)
      await runUp(ctx)
      const lines = sys.lines()
      expect(lines).toContain('podman:rootless network rm -f shared')
      expect(lines).toContain('systemctl:rootless start shared-network.service')
      const stopWeb = lines.indexOf('systemctl:rootless stop web.service')
      const rm = lines.indexOf('podman:rootless network rm -f shared')
      const startWeb = lines.indexOf('systemctl:rootless start web.service')
      expect(stopWeb).toBeGreaterThan(-1)
      expect(rm).toBeGreaterThan(stopWeb)
      expect(startWeb).toBeGreaterThan(rm)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('live network drift (podman says different subnet) marks it dirty', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      const d = makeContext(fx, (c) => {
        if (c.line.startsWith('podman:rootless network exists')) return { status: 0 }
        if (c.line.includes('{{range .Subnets}}{{.Subnet}}{{end}}'))
          return { stdout: '1.1.1.1/24\n' }
        return undefined
      })
      await runUp(d.ctx, { dryRun: true })
      expect(d.out).toContain('will update shared.network')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
