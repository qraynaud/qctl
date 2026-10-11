import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  configureNativeHelperEmbed,
  ensureVarlockLocalEncrypt,
  isCompiledQctlBinary,
  resetNativeHelperCache,
  resolveNativeHelperFromNpm,
  varlockLocalEncryptName,
} from './native-helper.js'
import { afterEach, describe, expect, test } from 'bun:test'

const origCache = process.env.QCTL_CACHE_HOME
const origOverride = process.env.QCTL_VARLOCK_LOCAL_ENCRYPT

afterEach(() => {
  if (origCache === undefined) delete process.env.QCTL_CACHE_HOME
  else process.env.QCTL_CACHE_HOME = origCache
  if (origOverride === undefined) delete process.env.QCTL_VARLOCK_LOCAL_ENCRYPT
  else process.env.QCTL_VARLOCK_LOCAL_ENCRYPT = origOverride
  configureNativeHelperEmbed(null)
  resetNativeHelperCache()
})

describe('varlock native-helper', () => {
  test('resolveNativeHelperFromNpm finds optionalDep when installed', () => {
    const bin = resolveNativeHelperFromNpm()
    expect(bin).toBeTruthy()
    expect(existsSync(/** @type {string} */ (bin))).toBe(true)
    expect(bin).toContain('varlock-local-encrypt')
  })

  test('isCompiledQctlBinary is false under bun test', () => {
    expect(isCompiledQctlBinary()).toBe(false)
  })

  test('ensureVarlockLocalEncrypt copies override into QCTL_CACHE_HOME', async () => {
    const base = mkdtempSync(join(tmpdir(), 'qctl-nh-'))
    process.env.QCTL_CACHE_HOME = base
    const fake = join(base, 'fake-helper')
    writeFileSync(fake, '#!/bin/sh\n')
    chmodSync(fake, 0o755)
    process.env.QCTL_VARLOCK_LOCAL_ENCRYPT = fake
    resetNativeHelperCache()

    const path = await ensureVarlockLocalEncrypt({ quiet: true })
    expect(path).toBe(join(base, 'tooling', 'native', varlockLocalEncryptName()))
    expect(existsSync(/** @type {string} */ (path))).toBe(true)
  })
})
