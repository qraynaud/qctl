import { ensurePlatformSeedKit, resolvePlatformRef } from './platform-tooling.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

const prevSeed = process.env.QCTL_ROCKY_SEED

afterEach(() => {
  if (prevSeed === undefined) delete process.env.QCTL_ROCKY_SEED
  else process.env.QCTL_ROCKY_SEED = prevSeed
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('platform-tooling', () => {
  test('resolvePlatformRef uses an explicit platform string', async () => {
    const ref = await resolvePlatformRef({ platform: 'rocky@0.3.0' })
    expect(ref.id).toBe('rocky')
    expect(ref.versionPin).toBe('0.3.0')
    expect(ref.moduleFile).toBe('qctl-platform-rocky.mjs')
  })

  test('resolvePlatformRef falls back to rocky when provision is unavailable', async () => {
    const ref = await resolvePlatformRef({
      env: 'dev',
      target: 'workstation',
      platform: '',
    })
    // empty platform string is treated as unset → try provision, else rocky
    expect(ref.id).toBe('rocky')
  })

  test('ensurePlatformSeedKit returns a readable seed root', async () => {
    spyOn(console, 'log').mockImplementation(() => {})
    const root = await ensurePlatformSeedKit()
    expect(root.length).toBeGreaterThan(0)
  })
})
