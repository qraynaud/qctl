import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  collectNpmPluginPins,
  collectNpmPluginPinsFromDir,
  ensureNpmPluginsFromDir,
  prefetchNpmPlugins,
} from './plugins.js'
import { describe, expect, test } from 'bun:test'

describe('collectNpmPluginPins', () => {
  test('extracts exact npm pins and skips local / unversioned', () => {
    const pins = collectNpmPluginPins(
      [
        '# @plugin(@qctl/vaultwarden-plugin@0.1.1)',
        '# @plugin(./local-plugin)',
        '# @plugin(@varlock/bitwarden-plugin@1.2.3)',
        '# @plugin(@qctl/vaultwarden-plugin@0.1.1)',
        '# @plugin(some-plugin)',
        '',
      ].join('\n'),
    )
    expect(pins.map((p) => p.descriptor).sort()).toEqual([
      '@qctl/vaultwarden-plugin@0.1.1',
      '@varlock/bitwarden-plugin@1.2.3',
    ])
  })
})

describe('collectNpmPluginPinsFromDir', () => {
  test('scans .env* files in a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qctl-plugin-pins-'))
    await writeFile(join(dir, '.env.schema'), '# ---\nX=\n')
    await writeFile(
      join(dir, '.env.prod'),
      '# @plugin(@qctl/vaultwarden-plugin@0.1.1)\nTANK_PASSPHRASE=\n',
    )
    await writeFile(join(dir, 'readme.txt'), '# @plugin(ignored@1.0.0)\n')
    const pins = collectNpmPluginPinsFromDir(dir)
    expect(pins).toEqual([
      {
        moduleName: '@qctl/vaultwarden-plugin',
        version: '0.1.1',
        descriptor: '@qctl/vaultwarden-plugin@0.1.1',
      },
    ])
  })
})

describe('prefetchNpmPlugins (bun patch)', () => {
  test('downloadPluginToCache writes plugins-cache under XDG_CONFIG_HOME', async () => {
    const xdg = await mkdtemp(join(tmpdir(), 'qctl-xdg-'))
    await mkdir(xdg, { recursive: true })
    const cached = await prefetchNpmPlugins(
      [
        {
          moduleName: '@qctl/vaultwarden-plugin',
          version: '0.1.1',
          descriptor: '@qctl/vaultwarden-plugin@0.1.1',
        },
      ],
      { xdgConfigHome: xdg },
    )
    expect(cached.length).toBe(1)
    expect(cached[0]).toContain('plugins-cache')
    expect(cached[0].startsWith(join(xdg, 'varlock'))).toBe(true)
  }, 60_000)
})

describe('ensureNpmPluginsFromDir', () => {
  test('no-op when no pins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qctl-plugin-empty-'))
    await writeFile(join(dir, '.env.schema'), '# ---\nX=\n')
    const r = await ensureNpmPluginsFromDir(dir)
    expect(r.pins).toEqual([])
    expect(r.cached).toEqual([])
  })

  test('downloads pins from dir into XDG plugins-cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qctl-plugin-dir-'))
    const xdg = await mkdtemp(join(tmpdir(), 'qctl-xdg-'))
    await writeFile(join(dir, '.env.schema'), '# ---\nX=\n')
    await writeFile(join(dir, '.env.dev'), '# @plugin(@qctl/vaultwarden-plugin@0.1.1)\nX=1\n')
    const r = await ensureNpmPluginsFromDir(dir, { xdgConfigHome: xdg })
    expect(r.pins.map((p) => p.descriptor)).toEqual(['@qctl/vaultwarden-plugin@0.1.1'])
    expect(r.cached[0]).toContain('plugins-cache')
  }, 60_000)
})
