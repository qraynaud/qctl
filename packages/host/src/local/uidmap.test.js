import { defaultAppsSubidRange } from '../provision/secrets-schema/users.js'
import { appsUidMapPodmanArgs } from './uidmap.js'
import { describe, expect, test } from 'bun:test'

describe('appsUidMapPodmanArgs', () => {
  test('splits low systemd map + provision apps subuid/subgid blocks', () => {
    const sub = defaultAppsSubidRange(900)
    // host 65536: reserve 0 for apps, 32768 for subuids → internal 32767 (0…32766)
    expect(appsUidMapPodmanArgs(900, 900, sub, sub)).toEqual([
      '--uidmap=0:1:900',
      '--uidmap=900:0:1',
      '--uidmap=901:901:31866',
      '--uidmap=900000:32767:32768',
      '--gidmap=0:1:900',
      '--gidmap=900:0:1',
      '--gidmap=901:901:31866',
      '--gidmap=900000:32767:32768',
    ])
  })

  test('uses distinct subgid when it differs', () => {
    const args = appsUidMapPodmanArgs(
      900,
      901,
      { start: 900000, count: 32768 },
      { start: 901000, count: 32768 },
    )
    expect(args).toContain('--uidmap=900000:32767:32768')
    expect(args).toContain('--gidmap=0:1:901')
    expect(args).toContain('--gidmap=901:0:1')
    expect(args).toContain('--gidmap=901000:32767:32768')
  })

  test('rejects apps id 0', () => {
    const sub = defaultAppsSubidRange(900)
    expect(() => appsUidMapPodmanArgs(0, 900, sub, sub)).toThrow(/uid/)
  })

  test('rejects subuid overlapping the internal map', () => {
    expect(() =>
      appsUidMapPodmanArgs(
        900,
        900,
        { start: 10000, count: 32768 },
        { start: 900000, count: 32768 },
      ),
    ).toThrow(/overlaps the internal map/)
  })
})
