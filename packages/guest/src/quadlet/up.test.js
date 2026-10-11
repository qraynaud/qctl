import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { removeTempDir, writeFile } from '../../../shared/src/test-helpers.js'
import { MARKER_DIR } from './apps.js'
import { runEnable } from './enable.js'
import { formatTable, runDown, runPs, runRestart, runStartStop } from './lifecycle.js'
import {
  networkPodmanName,
  networkSharedEngine,
  networkUnitGet,
  networkUnitParent,
} from './networks.js'
import { makeContext, makeQuadletInstance } from './test-fixture.js'
import { runUp } from './up.js'
import { describe, expect, test } from 'bun:test'

/** @param {{ root: string, sysDir: string }} fx */
const cleanup = (fx) => {
  removeTempDir(fx.root)
  removeTempDir(fx.sysDir)
}

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
      cleanup(fx)
    }
  })
})

describe('quadlet up', () => {
  test('dry-run: plans adds, installs nothing', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys, out } = makeContext(fx)
      await runUp(ctx, { dryRun: true })
      expect(out.filter((l) => l.startsWith('will add'))).toEqual([
        'will add dbroot',
        'will add proxy',
        'will add web',
      ])
      // new shared networks count as "update" (nothing installed yet), like the old bash
      expect(out).toContain('will update shared.network')
      expect(out).toContain('will update lan.network')
      expect(sys.calls.filter((c) => c.kind !== 'chown')).toEqual([])
      expect(existsSync(sys.paths('rootless').dest)).toBe(false)
    } finally {
      cleanup(fx)
    }
  })

  test('first run installs units, runtime env, autostart, shared networks, markers; restarts in dep order', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys, out } = makeContext(fx)
      await runUp(ctx)
      const rl = sys.paths('rootless')
      const rf = sys.paths('rootful')

      const web = readFileSync(join(rl.dest, 'web/web.container'), 'utf8')
      expect(web).toContain('Image=img/web:2.0-dev')
      expect(web).not.toContain('${')
      expect(readFileSync(join(rl.dest, 'web/web.container.d/autostart.conf'), 'utf8')).toContain(
        'WantedBy=default.target',
      )
      expect(
        readFileSync(join(rf.dest, 'dbroot/dbroot.container.d/autostart.conf'), 'utf8'),
      ).toContain('WantedBy=multi-user.target')
      expect(readFileSync(join(rl.dest, 'web/.env'), 'utf8')).toBe('A=2\nB=x.localhost\nC=3\n')
      expect(existsSync(join(rl.dest, 'web.network'))).toBe(true) // package-root shared
      expect(existsSync(join(rl.dest, 'web/web.network'))).toBe(true) // symlink into unit dir
      // shared nets land on their classified engine only
      expect(existsSync(join(rl.dest, 'shared.network'))).toBe(true)
      expect(existsSync(join(rf.dest, 'shared.network'))).toBe(false)
      expect(readFileSync(join(rf.dest, 'lan.network'), 'utf8')).toContain('parent=eth9')
      expect(existsSync(join(rl.dest, MARKER_DIR, 'web'))).toBe(true)
      expect(readFileSync(join(rf.dest, MARKER_DIR, 'dbroot'), 'utf8')).toContain('engine=rootful')

      // reload then restart: deps (proxy, dbroot) before web
      const lines = sys.lines()
      const reload = lines.indexOf('systemctl:rootless daemon-reload')
      const proxy = lines.indexOf('systemctl:rootless start proxy.service')
      const web_ = lines.indexOf('systemctl:rootless start web.service')
      expect(reload).toBeGreaterThan(-1)
      expect(proxy).toBeGreaterThan(reload)
      expect(web_).toBeGreaterThan(proxy)
      expect(lines).toContain('systemctl:rootful daemon-reload')
      expect(lines).toContain('systemctl:rootful start dbroot.service')
      expect(out.at(-1)).toBe('quadlet: done (restarted: dbroot proxy web)')
    } finally {
      cleanup(fx)
    }
  })

  test('second run is idempotent: no restarts; dry-run says nothing to do', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      const { ctx, sys, out } = makeContext(fx)
      await runUp(ctx)
      expect(sys.lines().filter((l) => /start|restart|daemon-reload/.test(l))).toEqual([])
      expect(out.at(-1)).toBe('quadlet: done (no restarts)')

      const d = makeContext(fx)
      await runUp(d.ctx, { dryRun: true })
      expect(d.out).toEqual(['nothing to do'])
    } finally {
      cleanup(fx)
    }
  })

  test('template change → will update / restart only that app', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      writeFile(fx.root, 'applications/web/.env.dev', 'VERSION=3.0\n')

      const d = makeContext(fx)
      await runUp(d.ctx, { dryRun: true })
      expect(d.out).toEqual(['will update web'])

      const { ctx, sys } = makeContext(fx)
      await runUp(ctx)
      expect(sys.lines().filter((l) => /^systemctl:\w+ (re)?start/.test(l))).toEqual([
        'systemctl:rootless start web.service',
      ])
    } finally {
      cleanup(fx)
    }
  })

  test('active unit is restarted, not started', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      writeFile(fx.root, 'applications/proxy/.env.dev', 'VERSION=9\n')
      const { ctx, sys } = makeContext(fx, (c) =>
        c.line.startsWith('systemctl:rootless is-active') ? { status: 0 } : undefined,
      )
      await runUp(ctx)
      expect(sys.lines()).toContain('systemctl:rootless restart proxy.service')
    } finally {
      cleanup(fx)
    }
  })

  test('orphan app (marker, no repo dir) is removed; dry-run plans it', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      rmSync(join(fx.root, 'applications/dbroot'), { recursive: true })
      // web still lists dbroot as companion; drop that too
      writeFile(fx.root, 'applications/web/app.yaml', 'engine: rootless\n')

      const d = makeContext(fx)
      await runUp(d.ctx, { dryRun: true })
      expect(d.out).toContain('will remove dbroot')

      const { ctx, sys } = makeContext(fx)
      await runUp(ctx)
      const rf = sys.paths('rootful')
      expect(existsSync(join(rf.dest, 'dbroot'))).toBe(false)
      expect(existsSync(join(rf.dest, MARKER_DIR, 'dbroot'))).toBe(false)
    } finally {
      cleanup(fx)
    }
  })

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
      cleanup(fx)
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
      cleanup(fx)
    }
  })

  test('filtered up: app + companions only; unknown app dies', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      await runUp(ctx, { app: 'proxy' })
      expect(existsSync(join(sys.paths('rootless').dest, 'web'))).toBe(false)
      expect(existsSync(join(sys.paths('rootless').dest, 'proxy/proxy.container'))).toBe(true)
      // proxy references shared.network → installed; lan (rootful, unreferenced) is not
      expect(existsSync(join(sys.paths('rootless').dest, 'shared.network'))).toBe(true)
      expect(existsSync(join(sys.paths('rootful').dest, 'lan.network'))).toBe(false)

      const { ctx: c2 } = makeContext(fx)
      await expect(runUp(c2, { app: 'ghost' })).rejects.toThrow(/unknown app 'ghost'/)

      const { ctx: c3, sys: s3 } = makeContext(fx)
      await runUp(c3, { app: 'applications/web' })
      // companion unit installed with the app
      expect(existsSync(join(s3.paths('rootful').dest, 'dbroot/dbroot.container'))).toBe(true)
    } finally {
      cleanup(fx)
    }
  })

  test('seeds markers from installed containers when none exist', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys, out } = makeContext(fx)
      const rl = sys.paths('rootless')
      writeFile(rl.dest, 'proxy/proxy.container', 'stale\n')
      await runUp(ctx)
      expect(out).toContain('quadlet: seeded enabled marker for proxy (rootless)')
      // seeded → not "add" (marker existed), but content differs → updated + restarted
      expect(out.some((l) => l.startsWith('quadlet: add proxy'))).toBe(false)
    } finally {
      cleanup(fx)
    }
  })
})

describe('quadlet enable / lifecycle', () => {
  test('enable renders units, shared nets for the engine, marker, and reloads', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys, out } = makeContext(fx)
      await runEnable(ctx, { app: 'web' })
      const rl = sys.paths('rootless')
      expect(readFileSync(join(rl.dest, 'web/web.container'), 'utf8')).toContain('2.0-dev')
      expect(existsSync(join(rl.dest, 'web/web.container.d/autostart.conf'))).toBe(true)
      expect(existsSync(join(rl.dest, 'shared.network'))).toBe(true)
      expect(existsSync(join(rl.dest, MARKER_DIR, 'web'))).toBe(true)
      expect(sys.lines()).toContain('systemctl:rootless daemon-reload')
      expect(out).toContain('engine=rootless owner=apps')
      expect(out).toContain('Start with: qctl quadlet start web')
    } finally {
      cleanup(fx)
    }
  })

  test('enable --no-install drops autostart + marker', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      await runEnable(ctx, { app: 'web' })
      await runEnable(ctx, { app: 'web', install: false })
      const rl = sys.paths('rootless')
      expect(existsSync(join(rl.dest, 'web/web.container.d/autostart.conf'))).toBe(false)
      expect(existsSync(join(rl.dest, MARKER_DIR, 'web'))).toBe(false)
    } finally {
      cleanup(fx)
    }
  })

  test('enable: unknown app / unresolved var die', async () => {
    const fx = makeQuadletInstance()
    try {
      await expect(runEnable(makeContext(fx).ctx, { app: 'ghost' })).rejects.toThrow(/unknown app/)
      writeFile(
        fx.root,
        'applications/proxy/proxy/proxy.container',
        '[Container]\nImage=${MISSING}\n',
      )
      await expect(runEnable(makeContext(fx).ctx, { app: 'proxy' })).rejects.toThrow(/unresolved/)
    } finally {
      cleanup(fx)
    }
  })

  test("start/stop/restart address the app's engine + services", async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      const a = makeContext(fx)
      runStartStop(a.ctx, 'start', 'web')
      expect(a.sys.lines()).toContain('systemctl:rootless start web.service')

      const b = makeContext(fx)
      runStartStop(b.ctx, 'stop', 'dbroot')
      expect(b.sys.lines()).toContain('systemctl:rootful stop dbroot.service')

      const c = makeContext(fx)
      runRestart(c.ctx, 'web')
      expect(c.sys.lines()).toContain('systemctl:rootless reset-failed web.service')
      expect(c.sys.lines()).toContain('systemctl:rootless start web.service') // fake: not active

      const d = makeContext(fx, (call) =>
        call.line.includes('is-active') ? { status: 0 } : undefined,
      )
      runRestart(d.ctx, 'web')
      expect(d.sys.lines()).toContain('systemctl:rootless restart web.service')
    } finally {
      cleanup(fx)
    }
  })

  test('start fails when systemctl fails; unknown app dies', () => {
    const fx = makeQuadletInstance()
    try {
      expect(() => runStartStop(makeContext(fx).ctx, 'start', 'ghost')).toThrow(
        /not installed and not in applications/,
      )
      const bad = makeContext(fx, (c) => (c.line.includes(' start ') ? { status: 5 } : undefined))
      expect(() => runStartStop(bad.ctx, 'start', 'web')).toThrow(/failed \(exit 5\)/)
    } finally {
      cleanup(fx)
    }
  })

  test('down removes installed files + marker and reloads', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      const { ctx, sys } = makeContext(fx)
      runDown(ctx, 'web')
      const rl = sys.paths('rootless')
      expect(existsSync(join(rl.dest, 'web'))).toBe(false)
      expect(existsSync(join(rl.dest, 'web.network'))).toBe(false)
      expect(existsSync(join(rl.dest, MARKER_DIR, 'web'))).toBe(false)
      expect(existsSync(join(rl.dest, 'proxy/proxy.container'))).toBe(true)
      expect(sys.lines()).toContain('systemctl:rootless stop web.service')
      expect(sys.lines()).toContain('systemctl:rootless daemon-reload')
      expect(() => runDown(makeContext(fx).ctx, 'nonexistent')).toThrow(
        /not installed and not in repo/,
      )
    } finally {
      cleanup(fx)
    }
  })

  test('ps: container status from podman, else systemd state, else not-installed', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      const { ctx, out } = makeContext(fx, (c) => {
        if (c.line.startsWith('podman:rootless container inspect proxy'))
          return { status: 0, stdout: 'abc123\n' }
        if (c.line.includes('--format {{.Status}}')) return { stdout: 'Up 5 minutes (healthy)\n' }
        if (c.line.includes('--format {{.Image}}')) return { stdout: 'img/proxy:1.0\n' }
        if (c.line.includes('is-active')) return { stdout: 'inactive\n', status: 3 }
        if (c.line.includes('container inspect')) return { status: 125 }
        return undefined
      })
      runPs(ctx)
      expect(out[0]).toMatch(/^ENGINE\s+NAMES\s+STATUS\s+IMAGE$/)
      expect(
        out.some((l) => /rootless\s+proxy\s+Up 5 minutes \(healthy\)\s+img\/proxy:1.0/.test(l)),
      ).toBe(true)
      expect(out.some((l) => /rootless\s+web\s+stopped/.test(l))).toBe(true)
      expect(out.some((l) => /rootful\s+dbroot\s+stopped/.test(l))).toBe(true)

      rmSync(join(makeContext(fx).sys.paths('rootless').dest, 'web/web.container'))
      const one = makeContext(fx, (c) =>
        c.line.includes('container inspect') ? { status: 125 } : undefined,
      )
      runPs(one.ctx, 'web')
      expect(one.out.some((l) => /rootless\s+web\s+not-installed/.test(l))).toBe(true)
    } finally {
      cleanup(fx)
    }
  })

  test('formatTable aligns columns', () => {
    expect(
      formatTable([
        ['A', 'BB'],
        ['CCC', 'D'],
      ]),
    ).toEqual(['A    BB', 'CCC  D'])
  })
})
