import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveProfile } from '@qctl/shared'
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  VAULTWARDEN_PLUGIN,
  VAULTWARDEN_PLUGIN_RANGE,
  defaultProjectAnswers,
  hostTimezone,
  projectDependencies,
  projectToProvisionMeta,
  promptProject,
  validateLayerName,
  writeProject,
} from './index.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { BindingPrompts } from '../../lib/binding.js' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('validateLayerName', () => {
  test('rejects dotted names; former layer basenames are allowed', () => {
    expect(validateLayerName('dev')).toBeUndefined()
    expect(validateLayerName('common')).toBeUndefined()
    expect(validateLayerName('workstation')).toBeUndefined()
    expect(validateLayerName('a.b')).toBeTruthy()
  })
})

describe('hostTimezone', () => {
  test('returns a non-empty IANA-ish string', () => {
    const tz = hostTimezone()
    expect(tz.length).toBeGreaterThan(0)
    expect(defaultProjectAnswers('/tmp/x').tz).toBe(tz)
  })
})

describe('projectToProvisionMeta / dependencies', () => {
  test('maps production envs and profiles', () => {
    const answers = defaultProjectAnswers('/tmp/x')
    answers.environments.prod = { production: true, appRoot: '/tank/apps' }
    answers.profiles.pve = { env: 'prod', target: 'proxmox' }
    answers.defaultProfile = 'lab'
    answers.shareTopology = true
    const meta = projectToProvisionMeta(answers)
    expect(meta.platform).toBe('rocky')
    expect(meta.environments).toEqual({
      dev: {},
      prod: { production: true },
    })
    expect(meta.profiles.pve).toEqual({ env: 'prod', target: 'proxmox' })
    expect(meta.defaultProfile).toBe('lab')
    expect(meta.sharedTopology).toEqual({})
  })

  test('varlock plugin deps from answers', () => {
    const off = defaultProjectAnswers('/tmp/x')
    expect(projectDependencies(off)).toEqual({})
    off.varlockPlugins = [{ package: VAULTWARDEN_PLUGIN, range: VAULTWARDEN_PLUGIN_RANGE }]
    expect(projectDependencies(off)).toEqual({
      [VAULTWARDEN_PLUGIN]: VAULTWARDEN_PLUGIN_RANGE,
    })
  })
})

describe('writeProject', () => {
  test('writes multi-env layout + common.yaml + root env values', () => {
    const root = join(makeTempDir(), 'custom')
    temps.push(join(root, '..'))
    const answers = defaultProjectAnswers(root, { initialName: 'custom-demo' })
    answers.environments = {
      staging: { production: false, appRoot: './volumes' },
      prod: { production: true, appRoot: '/tank/apps' },
    }
    answers.profiles = {
      lab: { env: 'staging', target: 'workstation' },
      pve: { env: 'prod', target: 'proxmox' },
    }
    answers.defaultProfile = 'lab'
    answers.tz = 'Europe/Paris'
    answers.varlockPlugins = [
      { package: VAULTWARDEN_PLUGIN, range: VAULTWARDEN_PLUGIN_RANGE },
      { package: '@varlock/1password-plugin', range: '*' },
    ]
    answers.shareTopology = true

    const report = writeProject(answers, { force: true })
    expect(report.root).toBe(root)
    expect(report.written).toContain('provision/common.yaml')
    expect(report.written).toContain('.env.staging')
    expect(report.written).toContain('.env.prod')

    const common = readFileSync(join(root, 'provision', 'common.yaml'), 'utf8')
    expect(common).toContain('platform: rocky')
    expect(common).toContain('default-profile: lab')
    expect(common).toMatch(/staging:/)
    expect(common).toMatch(/production:\s*true/)
    expect(common).toContain('networking:')
    expect(common).toContain('forward: 2222')
    expect(common).toContain('eth0:')

    expect(resolveProfile({ root })).toMatchObject({
      key: 'lab',
      env: 'staging',
      target: 'workstation',
    })

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('custom-demo')
    expect(pkg.dependencies[VAULTWARDEN_PLUGIN]).toBe(VAULTWARDEN_PLUGIN_RANGE)
    expect(pkg.dependencies['@varlock/1password-plugin']).toBe('*')

    const staging = readFileSync(join(root, '.env.staging'), 'utf8')
    expect(staging).toContain('ENV=staging')
    expect(staging).toContain('APP_ROOT=./volumes')
    expect(staging).toContain('TZ=Europe/Paris')

    const prod = readFileSync(join(root, '.env.prod'), 'utf8')
    expect(prod).toContain('APP_ROOT=/tank/apps')
    expect(prod).toContain(`@plugin(${VAULTWARDEN_PLUGIN})`)
    expect(prod).toContain('@plugin(@varlock/1password-plugin)')

    const schema = readFileSync(join(root, '.env.schema'), 'utf8')
    expect(schema).toMatch(/^QCTL_ENV=staging$/m)
  })
})

describe('promptProject', () => {
  test('scripted prompts build answers (no plugins)', async () => {
    const root = join(makeTempDir(), 'wiz')
    temps.push(join(root, '..'))

    /** @type {string[]} */
    const textQueue = [
      'wiz-app', // name
      hostTimezone(), // tz
      'dev', // env
      './volumes', // appRoot
      'lab', // profile
      // disks: interleaved (mode → OS size → structure + member sizes)
      '20G', // OS size
      'tank', // tank key
      '/tank', // tank mount
      'lab-tank-passphrase', // passphrase static
      'data', // vdev name
      'data1', // member name
      '2G', // tank member size
      // overlays: workstation
      '2', // cpu
      '4096', // memory
    ]
    /** @type {string[]} */
    const selectQueue = [
      'rocky', // platform
      'dev', // profile env
      'workstation', // target
      'virtual', // disks all virtual (early)
      'static', // tank passphrase kind
      'data', // vdev role
      'single', // vdev type
      'done', // ports done (lab presets)
      'done', // uplinks done (eth0)
      'omit', // ssh host_keys omit
    ]
    /** @type {boolean[]} */
    const confirmQueue = [
      false, // production
      false, // another env
      false, // another profile
      false, // need varlock plugins
      true, // share topology with future profiles
      false, // add data volume
      true, // add tank
      false, // more vdev members
      false, // more vdevs
      false, // customize tank options
      false, // another tank
      true, // use lab port presets
      false, // add VLANs
      false, // customize users
      true, // use ~/.ssh fallback for authorized_keys
      false, // configure guest repo clone
      false, // add registries
      false, // configure packages
      false, // add guest files
      true, // sync schema from YAML (!env refs)
    ]

    const answers = await promptProject(root, {
      prompts: /** @type {BindingPrompts} */ ({
        text: async () => textQueue.shift(),
        select: async () => selectQueue.shift(),
        confirm: async () => confirmQueue.shift(),
        multiselect: async () => {
          throw new Error('multiselect should not run when plugins declined')
        },
        isCancel: () => false,
      }),
    })
    expect(typeof answers).not.toBe('symbol')
    if (typeof answers === 'symbol') return
    expect(answers).toMatchObject({
      name: 'wiz-app',
      platform: 'rocky',
      tz: hostTimezone(),
      shareTopology: false,
      varlockPlugins: [],
    })
    expect(answers.defaultProfile).toBeUndefined()
    expect(answers.environments.dev).toEqual({
      production: false,
      appRoot: './volumes',
    })
    expect(answers.profiles.lab).toEqual({ env: 'dev', target: 'workstation' })
    expect(answers.disks?.sharedStructure).toBe(true)
    expect(answers.disks?.topology?.tanks.tank.mount).toBe('/tank')
    expect(answers.disks?.byProfile.lab?.tanks.tank.mount).toBe('/tank')
    expect(answers.disks?.byProfile.lab?.os).toEqual({ kind: 'virtual', size: '20G' })
    expect(answers.networking?.shared).toBe(false)
    expect(answers.networking?.topology.ports.ssh).toEqual({ port: 22, forward: 2222 })
    expect(answers.networking?.topology.uplinks.eth0).toEqual({ dhcp4: true })
    expect(answers.networking?.topology.vlans).toEqual({})
    expect(answers.overlays?.workstation).toEqual({ cpu: 2, memory: 4096 })
    expect(answers.overlays?.proxmox).toBeUndefined()
    expect(answers.usersSsh).toMatchObject({
      users: null,
      authorizedKeys: null,
      hostKeys: { kind: 'omit' },
    })
    expect(answers.repoReg).toMatchObject({
      repo: null,
      registries: [],
    })
    expect(answers.packagesFiles).toMatchObject({
      packages: null,
      files: null,
    })
    expect(answers.secrets?.syncSchemaFromYaml).toBe(true)
  })
})
