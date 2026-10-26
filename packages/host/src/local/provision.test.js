import * as execMod from './exec-in.js'
import { dummyIfacesShell, provisionAppliance } from './provision.js'
import * as utilMod from './util.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  execMod.execInAppliance.mockRestore?.()
  // @ts-expect-error restore
  utilMod.log.mockRestore?.()
})

describe('dummyIfacesShell', () => {
  test('empty → comment only', () => {
    expect(dummyIfacesShell([])).toMatch(/no type:dummy/)
    expect(dummyIfacesShell([])).not.toContain('ip link add')
  })

  test('emits create+up per iface', () => {
    const sh = dummyIfacesShell(['lab0', 'vlan2'])
    expect(sh).toContain('ip link add "lab0" type dummy')
    expect(sh).toContain('ip link set "lab0" up')
    expect(sh).toContain('ip link add "vlan2" type dummy')
    expect(sh).toContain('ip link set "vlan2" up')
  })
})

describe('provisionAppliance', () => {
  test('runs a bootstrap script inside the appliance', async () => {
    /** @type {string[]} */
    const scripts = []
    spyOn(utilMod, 'log').mockImplementation(() => {})
    spyOn(execMod, 'execInAppliance').mockImplementation(async (_ctx, script) => {
      scripts.push(script)
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await provisionAppliance({
      env: 'dev',
      name: 'qctl-local-x',
      root: '/tmp',
      appsUsername: 'apps',
      appsUid: 900,
      appsGid: 900,
      appsSubuid: { start: 900000, count: 65536 },
      appsSubgid: { start: 900000, count: 65536 },
      adminUsername: 'admin',
      adminUid: 1000,
      adminGid: 1000,
      repo: { vcs: 'git' },
      guestBin: '/x',
      platformModulePath: '/x',
      platformBasename: 'p.mjs',
      image: 'img',
      ports: {
        ssh: { port: 22, forward: 2222 },
        cockpit: { port: 9090, forward: 9090 },
      },
      dummyIfaces: ['vlan2'],
      publishArgs: [],
      uidMapArgs: [],
    })
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('APPS_USER="apps"')
    expect(scripts[0]).toContain('900000')
    expect(scripts[0]).toContain('/etc/qctl/config.json')
    expect(scripts[0]).toContain('"root": "/tank/rocky"')
    expect(scripts[0]).toContain('ip link add "vlan2" type dummy')
    expect(scripts[0]).not.toMatch(/ip link add vlan2 type dummy(?!")/)
  })

  test('omits dummy create when dummyIfaces empty', async () => {
    /** @type {string[]} */
    const scripts = []
    spyOn(utilMod, 'log').mockImplementation(() => {})
    spyOn(execMod, 'execInAppliance').mockImplementation(async (_ctx, script) => {
      scripts.push(script)
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await provisionAppliance({
      env: 'dev',
      name: 'qctl-local-x',
      root: '/tmp',
      appsUsername: 'apps',
      appsUid: 900,
      appsGid: 900,
      appsSubuid: { start: 900000, count: 65536 },
      appsSubgid: { start: 900000, count: 65536 },
      adminUsername: 'admin',
      adminUid: 1000,
      adminGid: 1000,
      repo: { vcs: 'git' },
      guestBin: '/x',
      platformModulePath: '/x',
      platformBasename: 'p.mjs',
      image: 'img',
      ports: {
        ssh: { port: 22, forward: 2222 },
        cockpit: { port: 9090, forward: 9090 },
      },
      dummyIfaces: [],
      publishArgs: [],
      uidMapArgs: [],
    })
    expect(scripts[0]).toContain('no type:dummy interfaces in provision')
    expect(scripts[0]).not.toContain('type dummy')
  })
})
