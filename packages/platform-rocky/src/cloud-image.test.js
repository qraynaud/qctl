import { CLOUD_IMAGE } from './cloud-image.js'
import { describe, expect, test } from 'bun:test'

describe('CLOUD_IMAGE pin', () => {
  test('has file, url, sha256', () => {
    expect(CLOUD_IMAGE.file).toMatch(/^Rocky-10-GenericCloud-Base-.*\.qcow2$/)
    expect(CLOUD_IMAGE.url).toContain(CLOUD_IMAGE.file)
    expect(CLOUD_IMAGE.sha256).toMatch(/^[a-f0-9]{64}$/)
  })
})
