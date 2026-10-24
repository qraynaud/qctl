import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { QCTL_GUEST_ISO_DIR, QCTL_SEED_ISO_DIR } from '@qctl/shared'
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { CIDATA_ROOT_ENV, GUEST_SRC_ENV, cidataPathsFromRoot, openCidata } from './cidata.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('cidataPathsFromRoot', () => {
  test('resolves guest + seed dirs', () => {
    const p = cidataPathsFromRoot('/mnt/cidata')
    expect(p.root).toBe('/mnt/cidata')
    expect(p.guestDir).toBe(join('/mnt/cidata', QCTL_GUEST_ISO_DIR))
    expect(p.seedDir).toBe(join('/mnt/cidata', QCTL_SEED_ISO_DIR))
  })
})

describe('openCidata', () => {
  test(`${CIDATA_ROOT_ENV} skips mount`, async () => {
    const root = makeTempDir()
    temps.push(root)
    mkdirSync(join(root, QCTL_GUEST_ISO_DIR), { recursive: true })
    mkdirSync(join(root, QCTL_SEED_ISO_DIR), { recursive: true })

    const h = await openCidata({
      env: { [CIDATA_ROOT_ENV]: root },
      findDevice: async () => {
        throw new Error('should not blkid')
      },
    })
    expect(h.mounted).toBe(false)
    expect(h.guestDir).toBe(join(root, QCTL_GUEST_ISO_DIR))
    expect(h.seedDir).toBe(join(root, QCTL_SEED_ISO_DIR))
    await h.close()
  })

  test(`${GUEST_SRC_ENV} resolves sibling seed dir`, async () => {
    const root = makeTempDir()
    temps.push(root)
    const guest = join(root, QCTL_GUEST_ISO_DIR)
    mkdirSync(guest, { recursive: true })
    mkdirSync(join(root, QCTL_SEED_ISO_DIR), { recursive: true })

    const h = await openCidata({ env: { [GUEST_SRC_ENV]: guest } })
    expect(h.mounted).toBe(false)
    expect(h.guestDir).toBe(guest)
    expect(h.seedDir).toBe(join(root, QCTL_SEED_ISO_DIR))
    await h.close()
  })

  test('mounts LABEL=cidata when no override', async () => {
    const mnt = makeTempDir()
    temps.push(mnt)
    /** @type {string[]} */
    const ops = []
    const h = await openCidata({
      env: {},
      findDevice: async () => '/dev/fake-cidata',
      mkdtemp: () => mnt,
      mountRo: async (dev, mountpoint) => {
        ops.push(`mount:${dev}:${mountpoint}`)
        mkdirSync(join(mountpoint, QCTL_GUEST_ISO_DIR), { recursive: true })
      },
      umount: async (mountpoint) => {
        ops.push(`umount:${mountpoint}`)
      },
    })
    expect(h.mounted).toBe(true)
    expect(h.root).toBe(mnt)
    expect(ops).toEqual([`mount:/dev/fake-cidata:${mnt}`])
    await h.close()
    expect(ops).toEqual([`mount:/dev/fake-cidata:${mnt}`, `umount:${mnt}`])
  })

  test('errors when no device', async () => {
    await expect(openCidata({ env: {}, findDevice: async () => null })).rejects.toThrow(
      /LABEL=cidata/,
    )
  })
})

describe('openCidata fixtures', () => {
  test('rejects missing CIDATA_ROOT', async () => {
    await expect(
      openCidata({ env: { [CIDATA_ROOT_ENV]: join('/tmp', 'no-such-cidata-xyz') } }),
    ).rejects.toThrow(/not a directory/)
  })

  test('smoke: write under guest dir', () => {
    const root = makeTempDir()
    temps.push(root)
    const guest = join(root, QCTL_GUEST_ISO_DIR)
    mkdirSync(guest, { recursive: true })
    writeFileSync(join(guest, 'qctl-guest'), 'bin\n')
    expect(cidataPathsFromRoot(root).guestDir).toBe(guest)
  })
})
