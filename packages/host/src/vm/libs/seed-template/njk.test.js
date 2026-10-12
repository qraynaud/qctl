import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { OMIT, renderTemplate } from './njk.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { YamlMapping } from '@qctl/shared' */

/**
 * @typedef {{ path?: string, content?: string } & YamlMapping} WriteFile
 */

/** @type {string[]} */
const temps = []
const origSeed = process.env.QCTL_ROCKY_SEED

afterEach(() => {
  if (origSeed === undefined) delete process.env.QCTL_ROCKY_SEED
  else process.env.QCTL_ROCKY_SEED = origSeed
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('renderTemplate', () => {
  test('renders !template and drops OMIT write_files entries', () => {
    const base = makeTempDir()
    temps.push(base)
    const seedKit = join(base, 'seed-kit')
    mkdirSync(join(seedKit, 'cloud-init'), { recursive: true })
    writeFileSync(join(seedKit, 'cloud-init', 'user-data.yaml'), 'hostname: rocky\n')
    process.env.QCTL_ROCKY_SEED = seedKit

    const file = join(base, 'user-data.yaml')
    writeFileSync(
      file,
      [
        'write_files:',
        '  - path: /etc/keep',
        '    content: !template |',
        '      hello {{ name }}',
        '  - path: /etc/drop',
        '    content: !template |',
        '      ',
        '',
      ].join('\n'),
    )
    // Test stub — only `name` is needed for this template body.
    // @ts-expect-error — intentional partial Nunjucks context
    const doc = renderTemplate(file, { name: 'world' }, true)
    expect(OMIT).toBeDefined()
    const writeFiles = Array.isArray(doc.write_files)
      ? /** @type {WriteFile[]} */ (doc.write_files)
      : []
    expect(writeFiles.map((w) => w.path)).toEqual(['/etc/keep'])
    expect(String(writeFiles[0]?.content).trim()).toBe('hello world')
  })
})
