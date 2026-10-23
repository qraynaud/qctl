/**
 * Bun test preload (`bunfig.toml` → `[test].preload`).
 * - Restores every `spyOn` / mock implementation after each test (strict isolation).
 * - Clears process-lifetime provision disk mount claims after every test.
 * - Removes `makeTempDir()` trees still live after a test (incl. failures).
 * - Scrubs known test-only `/tmp` prefixes that bypassed the helper.
 *
 * Prefer `spyOn` over `mock.module` — `mock.restore()` does not undo module overrides.
 */

import { diskMounts } from '../packages/host/src/provision/schema/disks.js'
import { removeAllTempDirs, scrubTestTempPrefixes } from '../packages/shared/src/test-helpers.js'
import { afterAll, afterEach, mock } from 'bun:test'

function cleanTemps() {
  removeAllTempDirs()
  scrubTestTempPrefixes()
}

afterEach(() => {
  mock.restore()
  mock.clearAllMocks()
  diskMounts.clear()
  cleanTemps()
})

afterAll(() => {
  cleanTemps()
})

// `die()` / hard `process.exit` skip afterEach — still try to scrub temps.
process.on('exit', () => {
  cleanTemps()
})
