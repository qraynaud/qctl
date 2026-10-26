import { provisionSchema } from './parse.js'
import { defaultAppsSubidRange, resolveUidGid, subuidSchema } from './users.js'
import { describe, expect, test } from 'bun:test'

describe('subuidSchema', () => {
  test('parses start:count', () => {
    expect(subuidSchema.parse('900000:32768')).toEqual({ start: 900000, count: 32768 })
  })

  test('rejects blank / omitted / bad shape', () => {
    expect(() => subuidSchema.parse('')).toThrow()
    expect(() => subuidSchema.parse(undefined)).toThrow()
    expect(() => subuidSchema.parse('nope')).toThrow(/start:count/)
  })

  test('rejects count above 32768', () => {
    expect(() => subuidSchema.parse('100000:65536')).toThrow(/32768|max/i)
  })
})

describe('resolveUidGid', () => {
  test('gid follows uid; only-gid keeps default uid', () => {
    expect(resolveUidGid(1000, null, 900)).toEqual({ uid: 1000, gid: 1000 })
    expect(resolveUidGid(null, 901, 900)).toEqual({ uid: 900, gid: 901 })
    expect(resolveUidGid(null, null, 900)).toEqual({ uid: 900, gid: 900 })
  })
})

describe('defaultAppsSubidRange', () => {
  test('uid × 1000 : max', () => {
    expect(defaultAppsSubidRange(900)).toEqual({ start: 900000, count: 32768 })
  })
})

describe('users in provisionSchema', () => {
  const net = {
    networking: {
      ports: { ssh: { port: 22, forward: 2222 } },
      interfaces: {
        main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
      },
    },
  }

  test('omitting users entirely defaults admin + apps', () => {
    const data = provisionSchema.parse({ ...net })
    expect(data.users.admin).toMatchObject({
      username: 'admin',
      uid: 1000,
      gid: 1000,
    })
    expect(data.users.apps).toMatchObject({
      username: 'apps',
      uid: 900,
      gid: 900,
      subuid: { start: 900000, count: 32768 },
      subgid: { start: 900000, count: 32768 },
    })
  })

  test('apps uid only → gid follows; username override', () => {
    const data = provisionSchema.parse({
      ...net,
      users: { apps: { username: 'quadlet', uid: 1100 } },
    })
    expect(data.users.apps).toMatchObject({
      username: 'quadlet',
      uid: 1100,
      gid: 1100,
      subuid: { start: 1100000, count: 32768 },
    })
  })

  test('apps gid only → uid stays 900', () => {
    const data = provisionSchema.parse({ ...net, users: { apps: { gid: 901 } } })
    expect(data.users.apps).toMatchObject({ uid: 900, gid: 901 })
  })

  test('admin uid only → gid follows', () => {
    const data = provisionSchema.parse({ ...net, users: { admin: { uid: 1200 } } })
    expect(data.users.admin).toMatchObject({ username: 'admin', uid: 1200, gid: 1200 })
  })

  test('rejects colliding admin/apps usernames', () => {
    expect(() =>
      provisionSchema.parse({
        ...net,
        users: { admin: { username: 'svc' }, apps: { username: 'svc' } },
      }),
    ).toThrow(/must differ/)
  })
})
