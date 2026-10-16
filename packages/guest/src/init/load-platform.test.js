import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { packagesMapWithRequired } from '@qctl/shared'
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { loadPlatformModule } from './load-platform.js'
import { PLATFORM_MODULE_NAME } from './platform.js'
import { afterEach, describe, expect, test } from 'bun:test'

const stubPackages = packagesMapWithRequired(
  Object.fromEntries(['curl', 'jq', 'unzip', 'zfs'].map((c) => [c, { distro: [c] }])),
)

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('loadPlatformModule', () => {
  test('imports and validates a staged platform module', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const path = join(dir, PLATFORM_MODULE_NAME)
    writeFileSync(
      path,
      `export const platform = {
  id: 'test-plat',
  packages: ${JSON.stringify(stubPackages)},
  async installPackages() {},
}
export default platform
`,
    )
    const platform = await loadPlatformModule({ QCTL_PLATFORM_MODULE: path })
    expect(platform.id).toBe('test-plat')
    expect(platform.packages.curl.distro).toEqual(['curl'])
    expect(typeof platform.installPackages).toBe('function')
  })

  test('rejects an invalid platform module', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const path = join(dir, PLATFORM_MODULE_NAME)
    writeFileSync(path, 'export default { id: "bad" }\n')
    await expect(loadPlatformModule({ QCTL_PLATFORM_MODULE: path })).rejects.toThrow()
  })
})
