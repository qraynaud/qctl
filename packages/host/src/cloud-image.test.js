import { join } from 'node:path'

import { IMAGE, loadCloudImageFromPlugin, resetCloudImageCache } from './cloud-image.js'
import { afterEach, describe, expect, test } from 'bun:test'

const ROOT = join(import.meta.dir, '..', '..', '..')
const PLATFORM_SRC = join(ROOT, 'packages/platform-rocky/src/platform.js')

describe('host cloud-image pin', () => {
  afterEach(() => {
    resetCloudImageCache()
  })

  test('loadCloudImageFromPlugin reads CLOUD_IMAGE export', async () => {
    const pin = await loadCloudImageFromPlugin(PLATFORM_SRC)
    expect(pin.file).toMatch(/^Rocky-10-GenericCloud-Base-.*\.qcow2$/)
    expect(pin.url).toContain(pin.file)
    expect(pin.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(IMAGE.file).toBe(pin.file)
    expect(IMAGE.sha256).toBe(pin.sha256)
  })

  test('IMAGE throws before pin is loaded', () => {
    expect(() => IMAGE.file).toThrow(/ensureCloudImage/)
  })
})
