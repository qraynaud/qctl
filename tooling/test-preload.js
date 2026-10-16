/**
 * Bun test preload (`bunfig.toml` → `[test].preload`).
 * Clears process-lifetime provision disk mount claims after every test so
 * files that parse `disks:` cannot leak uniqueness state into the next test.
 */

import { diskMounts } from '../packages/host/src/provision/schema/disks.js'
import { afterEach } from 'bun:test'

afterEach(() => {
  diskMounts.clear()
})
