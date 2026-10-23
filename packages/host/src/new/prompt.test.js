import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from '../init.js'
import { newPackage } from '../new.js'
import {
  assertPackageName,
  parseEngineFlag,
  resolveNewAppOptions,
  resolveNewNamedPackageOptions,
  resolveNewUnitOptions,
  resolvePackageName,
  scaffoldAppUnits,
} from './prompt.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { NewPrompts } from './prompt.js' */

/**
 * Loose test double — select generics don't match string literals from queues.
 * @param {object} [partial]
 * @returns {NewPrompts}
 */
function mockPrompts(partial = {}) {
  return /** @type {NewPrompts} */ ({
    text: async () => '',
    select: async () => '',
    confirm: async () => false,
    isCancel: () => false,
    ...partial,
  })
}

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('assertPackageName', () => {
  test('accepts lowercase hyphenated', () => {
    expect(() => assertPackageName('demo')).not.toThrow()
    expect(() => assertPackageName('my-app')).not.toThrow()
  })

  test('rejects invalid', () => {
    expect(() => assertPackageName('Bad')).toThrow(/invalid name/)
  })
})

describe('parseEngineFlag', () => {
  test('accepts rootless|rootful', () => {
    expect(parseEngineFlag('rootless')).toBe('rootless')
    expect(parseEngineFlag('rootful')).toBe('rootful')
    expect(parseEngineFlag(undefined)).toBe(null)
  })

  test('rejects unknown', () => {
    expect(() => parseEngineFlag('weird')).toThrow(/invalid --engine/)
  })
})

describe('resolvePackageName', () => {
  test('returns CLI value', async () => {
    expect(await resolvePackageName('demo', { label: 'name', message: 'App name' })).toBe('demo')
  })

  test('fails without name on non-TTY / --yes', async () => {
    await expect(
      resolvePackageName(undefined, { label: 'name', message: 'App name', yes: true }),
    ).rejects.toThrow(/name required/)
  })

  test('prompts on TTY when omitted', async () => {
    const name = await resolvePackageName(undefined, {
      label: 'name',
      message: 'App name',
      prompts: mockPrompts({ text: async () => 'from-prompt' }),
    })
    expect(name).toBe('from-prompt')
  })
})

describe('resolveNewAppOptions', () => {
  test('--yes with name defaults to rootless + demo unit', async () => {
    const opts = await resolveNewAppOptions({ name: 'demo', yes: true })
    expect(opts).toMatchObject({
      name: 'demo',
      engine: 'rootless',
      empty: false,
      force: false,
      yes: true,
    })
  })

  test('--yes without name fails', async () => {
    await expect(resolveNewAppOptions({ yes: true })).rejects.toThrow(/name required/)
  })

  test('--engine + --empty skips unit', async () => {
    const opts = await resolveNewAppOptions({
      name: 'demo',
      engine: 'rootful',
      empty: true,
    })
    expect(opts.engine).toBe('rootful')
    expect(opts.empty).toBe(true)
    expect(opts.unit).toBeUndefined()
  })
})

describe('scaffoldAppUnits', () => {
  test('--yes creates first demo unit named after the app', async () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'lab'))
    newPackage('app', 'demo', { cwd: instance, engine: 'rootless' })
    const written = await scaffoldAppUnits(
      'demo',
      { name: 'demo', force: false, yes: true, engine: 'rootless', empty: false, unit: undefined },
      { cwd: instance },
    )
    expect(written.some((p) => p === 'demo/demo.container')).toBe(true)
    expect(written.filter((p) => p.endsWith('.container')).length).toBe(1)
  })

  test('TTY first unit uses new unit flow (default name = app), then loop', async () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'lab'))
    newPackage('app', 'demo', { cwd: instance, engine: 'rootless' })

    /** @type {string[]} */
    const texts = ['demo', 'api']
    /** @type {boolean[]} */
    const confirms = [true, false]
    const written = await scaffoldAppUnits(
      'demo',
      { name: 'demo', force: false, yes: false, engine: 'rootless', empty: false, unit: undefined },
      {
        cwd: instance,
        prompts: mockPrompts({
          text: async () => texts.shift() ?? 'x',
          confirm: async () => confirms.shift() ?? false,
        }),
      },
    )
    expect(written.some((p) => p.startsWith('demo/'))).toBe(true)
    expect(written.some((p) => p.startsWith('api/'))).toBe(true)
  })
})

describe('resolveNewUnitOptions', () => {
  test('--yes requires app + name', async () => {
    await expect(resolveNewUnitOptions({ yes: true, name: 'web' })).rejects.toThrow(/app required/)
  })

  test('selects app when omitted', async () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'lab'))
    newPackage('app', 'demo', { cwd: instance, engine: 'rootless' })
    newPackage('app', 'other', { cwd: instance, engine: 'rootful' })

    const opts = await resolveNewUnitOptions(
      { name: 'web', empty: true },
      {
        cwd: instance,
        prompts: mockPrompts({ select: async () => 'other' }),
      },
    )
    expect(opts.app).toBe('other')
    expect(opts.name).toBe('web')
    expect(opts.container).toBe('none')
  })

  test('fails when no apps exist', async () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: instance } = initInstance(join(root, 'lab'))
    await expect(
      resolveNewUnitOptions({}, { cwd: instance, prompts: mockPrompts({}) }),
    ).rejects.toThrow(/no applications/)
  })
})

describe('resolveNewNamedPackageOptions', () => {
  test('uses CLI name', async () => {
    const opts = await resolveNewNamedPackageOptions(
      { name: 'vlan2', force: true },
      { kind: 'network' },
    )
    expect(opts).toEqual({ name: 'vlan2', force: true })
  })
})
