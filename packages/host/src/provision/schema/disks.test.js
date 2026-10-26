import {
  DEFAULT_TANK_OPTIONS,
  assertDisksDataFilesystems,
  collectDisksWarnings,
  diskMounts,
  disksSchema,
  disksTanksSchema,
  disksVdevSchema,
} from './disks.js'
import { provisionSchema } from './parse.js'
import { describe, expect, test } from 'bun:test'

const net = {
  networking: {
    ports: { ssh: { port: 22 } },
    interfaces: {
      main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
    },
  },
}

describe('disksSchema', () => {
  test('defaults os id to os and map ids to keys', () => {
    const d = disksSchema.parse({
      os: { size: '20G' },
      data: {
        vw: { mount: '/vw', size: '2G' },
      },
      tanks: {
        tank: {
          mount: '/tank',
          passphrase: 'secret',
          vdevs: {
            data0: {
              role: 'data',
              type: 'single',
              members: {
                'rocky-data0': { size: '2G' },
              },
            },
          },
        },
      },
    })
    expect(d?.os).toEqual({ id: 'os', size: '20G' })
    expect(d?.data?.vw).toEqual({ id: 'vw', mount: '/vw', size: '2G' })
    expect(d?.tanks?.tank.id).toBe('tank')
    expect(d?.tanks?.tank.vdevs.data0.members['rocky-data0'].id).toBe('rocky-data0')
  })

  test('applies TrueNAS-ish options defaults (aclmode passthrough)', () => {
    const tanks = disksTanksSchema.parse({
      tank: {
        mount: '/tank',
        vdevs: {
          data0: {
            role: 'data',
            type: 'mirror',
            members: { a: {}, b: {} },
          },
        },
      },
    })
    expect(tanks?.tank.options).toEqual({
      pool: { ...DEFAULT_TANK_OPTIONS.pool },
      dataset: { ...DEFAULT_TANK_OPTIONS.dataset },
      acl: { ...DEFAULT_TANK_OPTIONS.acl },
    })
    expect(tanks?.tank.options.acl.aclmode).toBe('passthrough')
  })

  test('honours explicit id overrides', () => {
    const d = disksSchema.parse({
      os: { id: 'serial-os', size: '20G' },
      data: {
        vw: { id: 'real-vw', mount: '/vw' },
      },
    })
    expect(d?.os?.id).toBe('serial-os')
    expect(d?.data?.vw.id).toBe('real-vw')
  })

  test('omit disks entirely is ok (platform OS default at resolve)', () => {
    expect(disksSchema.parse(undefined)).toBeUndefined()
  })

  test('rejects disks with neither data nor tanks', () => {
    expect(() => disksSchema.parse({ os: { size: '20G' } })).toThrow(
      /at least one data volume or tank/,
    )
    expect(() => disksSchema.parse({})).toThrow(/at least one data volume or tank/)
  })

  test('rejects duplicate disk ids and mounts', () => {
    expect(() =>
      disksSchema.parse({
        os: { id: 'shared', size: '20G' },
        data: { vw: { id: 'shared', mount: '/vw' } },
      }),
    ).toThrow(/duplicate disk id/)

    diskMounts.clear()
    expect(() =>
      disksSchema.parse({
        data: {
          a: { mount: '/x' },
          b: { mount: '/x' },
        },
      }),
    ).toThrow(/duplicate mount/)
  })

  test('rejects tank without a data vdev', () => {
    expect(() =>
      disksTanksSchema.parse({
        tank: {
          mount: '/tank',
          vdevs: {
            special0: {
              role: 'special',
              type: 'mirror',
              members: { a: {}, b: {} },
            },
          },
        },
      }),
    ).toThrow(/role: data/)
  })

  test('enforces vdev geometry mins', () => {
    expect(() =>
      disksVdevSchema.parse({
        role: 'data',
        type: 'raidz2',
        members: { a: {}, b: {} },
      }),
    ).toThrow(/enough members/)

    expect(
      disksVdevSchema.parse({
        role: 'data',
        type: 'mirror',
        members: { a: {}, b: {} },
      }).type,
    ).toBe('mirror')
  })
})

describe('collectDisksWarnings / assertDisksDataFilesystems', () => {
  test('warns on type=single and production data-only', () => {
    const disks = disksSchema.parse({
      data: { vw: { mount: '/vw' } },
      tanks: {
        tank: {
          mount: '/tank',
          vdevs: {
            data0: {
              role: 'data',
              type: 'single',
              members: { a: {} },
            },
          },
        },
      },
    })
    expect(collectDisksWarnings(disks)).toEqual([
      'disks.tanks.tank.vdevs.data0: type single has no redundancy',
    ])

    diskMounts.clear()
    const dataOnly = disksSchema.parse({ data: { vw: { mount: '/vw' } } })
    const envs = {
      prod: { production: true },
      dev: { production: false },
    }
    expect(collectDisksWarnings(dataOnly, { env: 'prod', environments: envs })).toEqual([
      'disks: production env with data volumes and no tanks (hardware RAID expected?)',
    ])
    expect(collectDisksWarnings(dataOnly, { env: 'dev', environments: envs })).toEqual([])
    expect(collectDisksWarnings(dataOnly, { production: true })).toEqual([
      'disks: production env with data volumes and no tanks (hardware RAID expected?)',
    ])
  })

  test('assertDisksDataFilesystems rejects unknown fs', () => {
    const disks = disksSchema.parse({
      data: { vw: { mount: '/vw', fs: 'zfs' } },
    })
    expect(() => assertDisksDataFilesystems(disks, ['xfs', 'ext4'])).toThrow(/FILESYSTEMS/)
    expect(() => assertDisksDataFilesystems(disks, ['xfs', 'ext4', 'zfs'])).not.toThrow()
    diskMounts.clear()
    expect(() =>
      assertDisksDataFilesystems(disksSchema.parse({ data: { vw: { mount: '/vw' } } }), ['xfs']),
    ).not.toThrow()
  })
})

describe('provisionSchema disks', () => {
  test('accepts disks.tanks passphrase for Tier-0 shape', () => {
    const data = provisionSchema.parse({
      ...net,
      disks: {
        tanks: {
          tank: {
            mount: '/tank',
            passphrase: Buffer.from('lab-tank'),
            vdevs: {
              data0: {
                role: 'data',
                type: 'single',
                members: { 'rocky-data0': { size: '2G' } },
              },
            },
          },
        },
      },
    })
    expect(data.disks?.tanks?.tank.passphrase).toBe('lab-tank')
    expect(data.disks?.tanks?.tank.id).toBe('tank')
  })
})
