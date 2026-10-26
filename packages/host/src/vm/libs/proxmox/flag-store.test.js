import { INSTALLED, VmFlagNotFoundError } from '../flags.js'
import {
  createFlagStore,
  formatProxmoxTags,
  parseProxmoxTags,
  preserveQctlFlagTagsOnForm,
  readFlagWireFromTags,
  tagsIndicateInstalled,
  withFlagWire,
} from './flag-store.js'
import { describe, expect, test } from 'bun:test'

describe('parseProxmoxTags / formatProxmoxTags', () => {
  test('splits on semicolon and comma, trims, dedupes', () => {
    expect(parseProxmoxTags('a; b, a ;c')).toEqual(['a', 'b', 'c'])
    expect(parseProxmoxTags(null)).toEqual([])
  })

  test('formats with semicolons', () => {
    expect(formatProxmoxTags(['a', 'b', 'a'])).toBe('a;b')
  })
})

describe('withFlagWire / readFlagWireFromTags', () => {
  test('sets scoped token without dropping others', () => {
    const next = withFlagWire('lab;other', 'installed', 'true')
    expect(next).toBe('lab;other;qctl.installed=true')
    expect(readFlagWireFromTags(parseProxmoxTags(next), 'installed')).toBe('true')
  })

  test('replaces existing flag token', () => {
    expect(withFlagWire('lab;qctl.installed=false', 'installed', 'true')).toBe(
      'lab;qctl.installed=true',
    )
  })

  test('deletes flag token', () => {
    expect(withFlagWire('lab;qctl.installed=true;x', 'installed', undefined)).toBe('lab;x')
  })
})

describe('tagsIndicateInstalled', () => {
  test('true only when decoded true', () => {
    expect(tagsIndicateInstalled('qctl.installed=true')).toBe(true)
    expect(tagsIndicateInstalled('qctl.installed=false')).toBe(false)
    expect(tagsIndicateInstalled('lab')).toBe(false)
  })
})

describe('preserveQctlFlagTagsOnForm', () => {
  test('merges qctl.* tags from live cfg', () => {
    const form = /** @type {Record<string, string>} */ ({ memory: '2048', tags: 'lab' })
    preserveQctlFlagTagsOnForm(form, { tags: 'qctl.installed=true;user' })
    expect(parseProxmoxTags(form.tags).sort()).toEqual(['lab', 'qctl.installed=true'].sort())
  })

  test('no-ops when live cfg has no qctl tags', () => {
    const form = /** @type {Record<string, string>} */ ({ memory: '2048' })
    preserveQctlFlagTagsOnForm(form, { tags: 'lab' })
    expect(form.tags).toBeUndefined()
  })
})

describe('createFlagStore (VmFlagStore)', () => {
  test('get/set/delete/entry for INSTALLED', async () => {
    /** @type {{ tags?: string }} */
    let cfg = { tags: 'lab' }
    /** @type {Record<string, unknown>[]} */
    const puts = []
    const client = {
      config: { node: 'pve' },
      qemuConfig: async () => cfg,
      /**
       * @param {unknown} _schema
       * @param {string} _path
       * @param {Record<string, unknown>} form
       */
      put: async (_schema, _path, form) => {
        puts.push(form)
        if (form.delete === 'tags') {
          cfg = {}
          return
        }
        if (typeof form.tags === 'string') cfg = { tags: form.tags }
      },
    }
    const store = createFlagStore(/** @type {any} */ (client), 42)
    expect(Object.keys(store).sort()).toEqual(['delete', 'entry', 'get', 'has', 'set'])

    expect(await store.has(INSTALLED)).toBe(false)
    await expect(store.get(INSTALLED)).rejects.toBeInstanceOf(VmFlagNotFoundError)

    await store.set(INSTALLED, true)
    expect(await store.has(INSTALLED)).toBe(true)
    expect(await store.get(INSTALLED)).toBe(true)
    expect(puts.at(-1)).toEqual({ tags: 'lab;qctl.installed=true' })

    const e = await store.entry(INSTALLED)
    expect(e.name).toBe('installed')
    expect(e.value).toBe(true)
    expect(e.schema).toBe(INSTALLED.schema)

    await store.delete(INSTALLED)
    expect(await store.has(INSTALLED)).toBe(false)
    await expect(store.get(INSTALLED)).rejects.toBeInstanceOf(VmFlagNotFoundError)
    expect(cfg.tags).toBe('lab')
  })

  test('delete sole qctl tag clears tags field', async () => {
    /** @type {{ tags?: string }} */
    let cfg = { tags: 'qctl.installed=true' }
    const client = {
      config: { node: 'pve' },
      qemuConfig: async () => cfg,
      /**
       * @param {unknown} _schema
       * @param {string} _path
       * @param {Record<string, unknown>} form
       */
      put: async (_schema, _path, form) => {
        if (form.delete === 'tags') cfg = {}
        else if (typeof form.tags === 'string') cfg = { tags: form.tags }
      },
    }
    await createFlagStore(/** @type {any} */ (client), 1).delete(INSTALLED)
    expect(cfg.tags).toBeUndefined()
  })
})
