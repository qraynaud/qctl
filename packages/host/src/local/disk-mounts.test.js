import {
  LOCAL_DISK_KIND,
  guestMountDepth,
  localDiskHostRel,
  localDiskMounts,
  normalizeGuestMount,
} from './disk-mounts.js'
import { describe, expect, test } from 'bun:test'

describe('normalizeGuestMount / guestMountDepth', () => {
  test('trims and strips trailing slashes', () => {
    expect(normalizeGuestMount(' /tank/ ')).toBe('/tank')
    expect(normalizeGuestMount('/vw///')).toBe('/vw')
    expect(normalizeGuestMount('/')).toBe('/')
  })

  test('depth counts path segments', () => {
    expect(guestMountDepth('/')).toBe(0)
    expect(guestMountDepth('/tank')).toBe(1)
    expect(guestMountDepth('/tank/rocky')).toBe(2)
  })
})

describe('localDiskHostRel', () => {
  test('namespaces by kind + map key', () => {
    expect(localDiskHostRel(LOCAL_DISK_KIND.TANK, 'tank')).toBe('volumes/tank/tank')
    expect(localDiskHostRel(LOCAL_DISK_KIND.DATA, 'vw')).toBe('volumes/data/vw')
  })
})

describe('localDiskMounts', () => {
  test('empty / missing disks → []', () => {
    expect(localDiskMounts(undefined)).toEqual([])
    expect(localDiskMounts(null)).toEqual([])
    expect(localDiskMounts({})).toEqual([])
    expect(localDiskMounts({ data: {}, tanks: {} })).toEqual([])
  })

  test('maps data + tanks keys to hostRel and mount', () => {
    const mounts = localDiskMounts({
      data: { vw: { mount: '/vw' } },
      tanks: { tank: { mount: '/tank' } },
    })
    expect(mounts).toEqual([
      {
        kind: LOCAL_DISK_KIND.TANK,
        key: 'tank',
        hostRel: 'volumes/tank/tank',
        mount: '/tank',
      },
      {
        kind: LOCAL_DISK_KIND.DATA,
        key: 'vw',
        hostRel: 'volumes/data/vw',
        mount: '/vw',
      },
    ])
  })

  test('same map key in data and tanks stays distinct via namespace', () => {
    const mounts = localDiskMounts({
      data: { shared: { mount: '/data-shared' } },
      tanks: { shared: { mount: '/tank-shared' } },
    })
    expect(mounts.map((m) => m.hostRel).sort()).toEqual([
      'volumes/data/shared',
      'volumes/tank/shared',
    ])
  })

  test('sorts parent mounts before nested children', () => {
    const mounts = localDiskMounts({
      data: {
        deep: { mount: '/tank/apps' },
        vw: { mount: '/vw' },
      },
      tanks: { tank: { mount: '/tank' } },
    })
    expect(mounts.map((m) => m.mount)).toEqual(['/tank', '/vw', '/tank/apps'])
  })

  test('skips entries without a mount', () => {
    expect(
      localDiskMounts({
        data: { bare: {}, vw: { mount: '/vw' } },
        tanks: { empty: { mount: '  ' } },
      }),
    ).toEqual([
      {
        kind: LOCAL_DISK_KIND.DATA,
        key: 'vw',
        hostRel: 'volumes/data/vw',
        mount: '/vw',
      },
    ])
  })
})
