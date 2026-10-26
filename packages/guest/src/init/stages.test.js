import { join } from 'node:path'

import { REGISTRY } from './stages/index.js'
import {
  ALL_STAGES,
  DEFAULT_STAGES,
  INIT_TANK_STAGES,
  PROFILES,
  isStage,
  stagesForProfile,
} from './stages.js'
import { describe, expect, test } from 'bun:test'

describe('profiles', () => {
  test('default stage order (ordering constraint: seal → keys/admin → services → tank → clone → stamp)', () => {
    expect([...DEFAULT_STAGES]).toEqual([
      'ensure-dummies',
      'network-up',
      'host-baseline',
      'data-mounts',
      'tier0-seal',
      'ssh-host-keys',
      'admin-user',
      'start-services',
      'registry-login',
      'tank-import',
      'zfs-drill',
      'hg-clone',
      'ready-stamp',
    ])
  })

  test('init-tank stage order', () => {
    expect([...INIT_TANK_STAGES]).toEqual(['tier0-seal', 'data-mounts', 'tank-create', 'poweroff'])
  })

  test('stagesForProfile', () => {
    expect(stagesForProfile('default')).toBe(DEFAULT_STAGES)
    expect(stagesForProfile('init-tank')).toBe(INIT_TANK_STAGES)
    expect(() => stagesForProfile('nope')).toThrow(/unknown profile/)
    expect([...PROFILES]).toEqual(['default', 'init-tank'])
  })

  test('ALL_STAGES covers both profiles without duplicates', () => {
    expect(new Set(ALL_STAGES).size).toBe(ALL_STAGES.length)
    for (const s of [...DEFAULT_STAGES, ...INIT_TANK_STAGES]) expect(ALL_STAGES).toContain(s)
    expect(isStage('tank-create')).toBe(true)
    expect(isStage('nope')).toBe(false)
  })
})

describe('registry', () => {
  test('every listed stage has an implementation and vice versa', () => {
    expect([...REGISTRY.keys()].sort()).toEqual([...ALL_STAGES].sort())
  })
})

describe('first-boot stages (provision → Tier-0)', () => {
  const read = (/** @type {string} */ rel) => Bun.file(join(import.meta.dir, rel)).text()

  test('all former shell stages are JS', async () => {
    for (const name of [
      'ensure-dummies',
      'network-up',
      'host-baseline',
      'data-mounts',
      'tier0-seal',
      'start-services',
      'poweroff',
      'ssh-host-keys',
      'admin-user',
      'hg-clone',
      'tank-import',
      'tank-create',
      'zfs-drill',
    ]) {
      expect(REGISTRY.get(name)?.run).toBeTypeOf('function')
      const src = await read(`stages/${name}.js`)
      expect(src).not.toMatch(/bashStage|with \{ type: 'text' \}/)
    }
    expect(await read('stages/lib/tank.js')).toContain('ensureTankPassphraseFromBootstrap')
    expect(await read('stages/ssh-host-keys.js')).toContain('SSH_HOST_KEYS')
    expect(await read('stages/admin-user.js')).toContain('ADMIN_USERNAME')
    expect(await read('stages/hg-clone.js')).toContain('DEPLOY_KEY')
    expect(await read('stages/registry-login.js')).toContain('ROCKY_REGISTRIES')
  })
})
