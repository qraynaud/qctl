import * as execMod from './exec-in.js'
import {
  dummyIfacesShell,
  ensureLocalDiskMountOwnership,
  ensureQctlSystemdUnits,
  provisionAppliance,
  qctlUnitTextsFromSeed,
} from './provision.js'
import * as utilMod from './util.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { LocalContext } from './context.js' */

afterEach(() => {
  // @ts-expect-error restore
  execMod.execInAppliance.mockRestore?.()
  // @ts-expect-error restore
  utilMod.log.mockRestore?.()
})

/**
 * @param {Partial<LocalContext>} [over]
 * @returns {LocalContext}
 */
function fakeCtx(over = {}) {
  return /** @type {LocalContext} */ ({
    env: 'dev',
    name: 'qctl-local-x',
    root: '/tmp',
    repoDir: '/tank/rocky',
    diskMounts: [],
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
    encryptPath: null,
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
    ...over,
  })
}

describe('qctlUnitTextsFromSeed', () => {
  test('reads supervisor + qctl-app@ from host seed kit', () => {
    const { supervisor, appProxy } = qctlUnitTextsFromSeed()
    expect(supervisor).toContain('ExecStart=/usr/local/bin/qctl _internal_supervisor')
    expect(appProxy).toContain('ExecStart=/usr/local/bin/qctl _internal_app_proxy %i')
    expect(appProxy).toContain('Wants=qctl-supervisor.service')
  })
})

describe('ensureLocalDiskMountOwnership', () => {
  test('chowns disk mount roots (not repoDir)', async () => {
    /** @type {string[]} */
    const scripts = []
    spyOn(execMod, 'execInAppliance').mockImplementation(async (_ctx, script) => {
      scripts.push(script)
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await ensureLocalDiskMountOwnership(
      fakeCtx({
        diskMounts: [
          { kind: 'tank', key: 'tank', hostRel: 'volumes/tank/tank', mount: '/tank' },
          { kind: 'data', key: 'vw', hostRel: 'volumes/data/vw', mount: '/vw' },
        ],
      }),
    )
    expect(scripts[0]).toContain('mkdir -p "/tank"')
    expect(scripts[0]).toContain('chown -R "$APPS_USER:$APPS_USER" "/tank"')
    expect(scripts[0]).toContain('mkdir -p "/vw"')
    expect(scripts[0]).not.toContain('/tank/rocky')
    expect(scripts[0]).not.toContain('local-overrides')
  })

  test('no-op when there are no disk mounts', async () => {
    const spy = spyOn(execMod, 'execInAppliance').mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
    await ensureLocalDiskMountOwnership(fakeCtx({ diskMounts: [] }))
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('ensureQctlSystemdUnits', () => {
  test('writes units, reloads, and enable --now supervisor', async () => {
    /** @type {string[]} */
    const scripts = []
    spyOn(utilMod, 'log').mockImplementation(() => {})
    spyOn(execMod, 'execInAppliance').mockImplementation(async (_ctx, script) => {
      scripts.push(script)
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await ensureQctlSystemdUnits(fakeCtx())
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('qctl-supervisor.service')
    expect(scripts[0]).toContain('qctl-app@.service')
    expect(scripts[0]).toContain('/etc/systemd/user/qctl-app@.service')
    expect(scripts[0]).toContain('systemctl enable --now qctl-supervisor.service')
    expect(scripts[0]).toContain('_internal_supervisor')
    expect(scripts[0]).toContain('_internal_app_proxy %i')
    expect(scripts[0]).toContain('APPS_USER="apps"')
  })
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
    await provisionAppliance(
      fakeCtx({
        diskMounts: [{ kind: 'tank', key: 'tank', hostRel: 'volumes/tank/tank', mount: '/tank' }],
        dummyIfaces: ['vlan2'],
      }),
    )
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('APPS_USER="apps"')
    expect(scripts[0]).toContain('900000')
    expect(scripts[0]).toContain('/etc/qctl/config.json')
    expect(scripts[0]).toContain('"root": "/tank/rocky"')
    expect(scripts[0]).toContain('mkdir -p "/tank"')
    expect(scripts[0]).toContain('chown -R "$APPS_USER:$APPS_USER" "/tank"')
    expect(scripts[0]).not.toContain('local-overrides')
    expect(scripts[0]).not.toContain('APP_ROOT=')
    expect(scripts[0]).not.toContain('TANK_ROOT=')
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
    await provisionAppliance(fakeCtx({ dummyIfaces: [] }))
    expect(scripts[0]).toContain('no type:dummy interfaces in provision')
    expect(scripts[0]).not.toContain('type dummy')
  })
})
