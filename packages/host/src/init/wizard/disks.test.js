import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  applyDisksAnswers,
  envAttachmentsToPlain,
  envDisksToPlain,
  physicalIdPlaceholder,
  renderEnvDisksYaml,
  topologyToPlain,
  validateEnvDisks,
} from './disks.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { DisksTopology, EnvDisksAnswers } from './disks.js' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

/** @returns {EnvDisksAnswers} */
function sampleDisks() {
  return {
    os: { kind: 'virtual', size: '20G' },
    data: {
      vw: { mount: '/vw', disk: { kind: 'virtual', size: '2G' } },
    },
    tanks: {
      tank: {
        mount: '/tank',
        passphrase: { kind: 'static', value: 'lab-pass' },
        options: null,
        vdevs: {
          data: {
            role: 'data',
            type: 'mirror',
            members: {
              data1: { kind: 'virtual', size: '2G' },
              data2: { kind: 'virtual', size: '2G' },
            },
          },
        },
      },
    },
  }
}

describe('physicalIdPlaceholder / validateEnvDisks', () => {
  test('placeholder sanitizes keys', () => {
    expect(physicalIdPlaceholder('os')).toBe('SET_PHYSICAL_DISK_ID_OS')
    expect(physicalIdPlaceholder('data-vw')).toBe('SET_PHYSICAL_DISK_ID_DATA_VW')
  })

  test('requires data or tank', () => {
    expect(
      validateEnvDisks({
        os: { kind: 'virtual', size: '20G' },
        data: {},
        tanks: {},
      }),
    ).toMatch(/data volume or tank/)
    expect(validateEnvDisks(sampleDisks())).toBeUndefined()
  })
})

describe('render / apply disks', () => {
  test('renderEnvDisksYaml emits size and static passphrase', () => {
    const text = renderEnvDisksYaml(sampleDisks())
    expect(text).toContain('disks:')
    expect(text).toContain('size: 20G')
    expect(text).toContain('mount: /vw')
    expect(text).toContain('passphrase: lab-pass')
    expect(text).not.toContain('__PASS__')
  })

  test('omit passphrase → no passphrase key (unencrypted)', () => {
    const disks = sampleDisks()
    disks.tanks.tank.passphrase = { kind: 'omit' }
    const text = renderEnvDisksYaml(disks)
    expect(text).toContain('mount: /tank')
    expect(text).not.toContain('passphrase:')
  })

  test('physical members use id placeholders in plain object', () => {
    const disks = sampleDisks()
    disks.os = { kind: 'physical', id: physicalIdPlaceholder('os') }
    disks.data = {}
    disks.tanks.tank.vdevs.data.members = {
      data1: { kind: 'physical', id: physicalIdPlaceholder('data1') },
      data2: { kind: 'physical', id: 'scsi-REAL' },
    }
    const plain = envDisksToPlain(disks)
    expect(/** @type {{ id?: string }} */ (plain.os).id).toBe('SET_PHYSICAL_DISK_ID_OS')
    const yaml = renderEnvDisksYaml(disks)
    expect(yaml).toContain('id: SET_PHYSICAL_DISK_ID_DATA1')
    expect(yaml).toContain('id: scsi-REAL')
    expect(yaml).not.toMatch(/data1:[\s\S]*?size:/)
  })

  test('applyDisksAnswers writes profile overlay + secret schema', () => {
    const root = makeTempDir()
    temps.push(root)
    mkdirSync(join(root, 'provision'), { recursive: true })
    writeFileSync(join(root, 'provision', 'profile-lab.yaml'), '# Profile layer (lab).\n', 'utf8')
    writeFileSync(join(root, 'provision', '.env.schema'), '# ---\n', 'utf8')
    writeFileSync(join(root, 'provision', '.env.dev'), '# ---\n', 'utf8')

    const disks = sampleDisks()
    disks.tanks.tank.passphrase = {
      kind: 'secret',
      name: 'TANK_PASSPHRASE',
      encoding: 'utf8',
      value: 's3cret',
    }

    applyDisksAnswers(
      root,
      { sharedStructure: false, byProfile: { lab: disks } },
      { profiles: { lab: { env: 'dev', target: 'workstation' } } },
    )

    const yaml = readFileSync(join(root, 'provision', 'profile-lab.yaml'), 'utf8')
    expect(yaml).toContain('disks:')
    expect(yaml).toContain('passphrase: !env TANK_PASSPHRASE')
    expect(readFileSync(join(root, 'provision', '.env.schema'), 'utf8')).toContain(
      'TANK_PASSPHRASE=',
    )
    expect(readFileSync(join(root, 'provision', '.env.dev'), 'utf8')).toContain(
      'TANK_PASSPHRASE=s3cret',
    )
  })

  test('topologyToPlain omits sizes/ids; envAttachmentsToPlain is overrides only', () => {
    /** @type {DisksTopology} */
    const topology = {
      data: { vw: { mount: '/vw' } },
      tanks: {
        tank: {
          mount: '/tank',
          passphrase: { kind: 'static', value: 'lab-pass' },
          options: null,
          vdevs: {
            data: { role: 'data', type: 'mirror', memberKeys: ['data1', 'data2'] },
          },
        },
      },
    }
    const plain = topologyToPlain(topology)
    expect(plain).toMatchObject({
      data: { vw: { mount: '/vw' } },
      tanks: {
        tank: {
          mount: '/tank',
          passphrase: '__PASS__:tank',
          vdevs: {
            data: {
              role: 'data',
              type: 'mirror',
              members: { data1: {}, data2: {} },
            },
          },
        },
      },
    })
    expect(JSON.stringify(plain)).not.toMatch(/size|SET_PHYSICAL/)

    const overrides = envAttachmentsToPlain(sampleDisks())
    expect(overrides).toEqual({
      os: { size: '20G' },
      data: { vw: { size: '2G' } },
      tanks: {
        tank: {
          vdevs: {
            data: {
              members: {
                data1: { size: '2G' },
                data2: { size: '2G' },
              },
            },
          },
        },
      },
    })
    expect(JSON.stringify(overrides)).not.toContain('mount')
    expect(JSON.stringify(overrides)).not.toContain('passphrase')
  })

  test('shared structure → common topology + profile overlay size/id overrides', () => {
    const root = makeTempDir()
    temps.push(root)
    mkdirSync(join(root, 'provision'), { recursive: true })
    writeFileSync(
      join(root, 'provision', 'common.yaml'),
      '# Shared foundation.\nqctl:\n  platform: rocky\n',
      'utf8',
    )
    writeFileSync(
      join(root, 'provision', 'profile-lab.yaml'),
      '# Profile lab.\nworkstation:\n  cpu: 2\n',
      'utf8',
    )
    writeFileSync(
      join(root, 'provision', 'profile-prod-px.yaml'),
      '# Profile prod-px.\nproxmox:\n  node: pve\n',
      'utf8',
    )

    /** @type {DisksTopology} */
    const topology = {
      data: { vw: { mount: '/vw' } },
      tanks: {
        tank: {
          mount: '/tank',
          passphrase: { kind: 'static', value: 'lab-pass' },
          options: null,
          vdevs: {
            data: { role: 'data', type: 'mirror', memberKeys: ['data1', 'data2'] },
          },
        },
      },
    }
    const lab = sampleDisks()
    const prodPx = sampleDisks()
    prodPx.os = { kind: 'virtual', size: '40G' }
    prodPx.tanks.tank.vdevs.data.members.data1 = {
      kind: 'physical',
      id: physicalIdPlaceholder('data1'),
    }

    applyDisksAnswers(
      root,
      { sharedStructure: true, topology, byProfile: { lab, 'prod-px': prodPx } },
      {
        profiles: {
          lab: { env: 'dev', target: 'workstation' },
          'prod-px': { env: 'prod', target: 'proxmox' },
        },
      },
    )

    const common = readFileSync(join(root, 'provision', 'common.yaml'), 'utf8')
    expect(common).toContain('platform: rocky')
    expect(common).toContain('mount: /vw')
    expect(common).toContain('mount: /tank')
    expect(common).toContain('passphrase: lab-pass')
    expect(common).toContain('role: data')
    expect(common).toMatch(/data1:\s*\{\}/)
    expect(common).not.toContain('size:')
    expect(common).not.toContain('os:')

    const labYaml = readFileSync(join(root, 'provision', 'profile-lab.yaml'), 'utf8')
    expect(labYaml).toContain('cpu: 2')
    expect(labYaml).toContain('size: 20G')
    expect(labYaml).not.toContain('mount:')
    expect(labYaml).not.toContain('passphrase:')
    expect(labYaml).not.toContain('role:')

    const prodYaml = readFileSync(join(root, 'provision', 'profile-prod-px.yaml'), 'utf8')
    expect(prodYaml).toContain('node: pve')
    expect(prodYaml).toContain('size: 40G')
    expect(prodYaml).toContain('id: SET_PHYSICAL_DISK_ID_DATA1')
    expect(prodYaml).not.toContain('mount:')
  })
})
