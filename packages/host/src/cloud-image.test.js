import { join } from 'node:path'

import {
  IMAGE,
  loadCloudImageFromPlugin,
  resolveCloudImagePinPath,
  workspaceCloudImagePath,
} from './cloud-image.js'
import { describe, expect, test } from 'bun:test'

const ROOT = join(import.meta.dir, '..', '..', '..')

describe('host cloud-image pin', () => {
  test('resolves workspace sibling JSON', () => {
    expect(resolveCloudImagePinPath()).toBe(workspaceCloudImagePath())
  })

  test('IMAGE matches pin shape', () => {
    expect(IMAGE.file).toMatch(/^Rocky-9-GenericCloud-Base-.*\.qcow2$/)
    expect(IMAGE.url).toContain(IMAGE.file)
    expect(IMAGE.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  test('loadCloudImageFromPlugin reads CLOUD_IMAGE export', async () => {
    const mod = join(ROOT, 'packages/platform-rocky/src/platform.js')
    const pin = await loadCloudImageFromPlugin(mod)
    expect(pin.file).toBe(IMAGE.file)
    expect(pin.sha256).toBe(IMAGE.sha256)
  })
})
