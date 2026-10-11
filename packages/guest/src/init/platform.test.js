import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '../../../shared/src/test-helpers.js'
import { PLATFORM_MODULE_NAME, resolvePlatformModule } from './platform.js'
import { describe, expect, test } from 'bun:test'

describe('resolvePlatformModule', () => {
  test('QCTL_PLATFORM_MODULE wins', () => {
    const a = makeTempDir()
    const b = makeTempDir()
    try {
      const explicit = join(a, PLATFORM_MODULE_NAME)
      writeFileSync(explicit, 'export default {}\n')
      writeFileSync(join(b, PLATFORM_MODULE_NAME), 'export default {}\n')
      expect(
        resolvePlatformModule({
          env: { QCTL_PLATFORM_MODULE: explicit, QCTL_LIB_DIR: b },
        }),
      ).toBe(explicit)
    } finally {
      removeTempDir(a)
      removeTempDir(b)
    }
  })

  test('prefers lib dir over sibling', () => {
    const lib = makeTempDir()
    const sib = makeTempDir()
    try {
      const libMod = join(lib, PLATFORM_MODULE_NAME)
      writeFileSync(libMod, 'export default {}\n')
      writeFileSync(join(sib, PLATFORM_MODULE_NAME), 'export default {}\n')
      expect(
        resolvePlatformModule({
          env: { QCTL_LIB_DIR: lib },
          execPath: join(sib, 'qctl'),
        }),
      ).toBe(libMod)
    } finally {
      removeTempDir(lib)
      removeTempDir(sib)
    }
  })

  test('not found → helpful error', () => {
    expect(() =>
      resolvePlatformModule({
        env: { QCTL_LIB_DIR: '/nonexistent-lib' },
        execPath: '/nonexistent/qctl',
      }),
    ).toThrow(/qctl-platform-\*\.mjs not found/)
  })
})
