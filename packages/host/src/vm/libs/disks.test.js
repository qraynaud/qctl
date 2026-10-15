import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as zx from 'zx'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import * as paths from '../../lib/paths.js'
import * as util from '../../lib/util.js'
import { resolveDisks } from '../../provision/schema/resolve-disks.js'
import { ensureDisks, persistentDisks, vmPaths } from './disks.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { ResolvedDisks } from '../../provision/schema/resolve-disks.js' */

const platform = {
  filesystems: /** @type {const} */ (['xfs', 'ext4']),
  defaultFs: 'xfs',
  osDisk: { id: 'os', size: '20G' },
}

/** @returns {ResolvedDisks} */
function sampleResolved() {
  return resolveDisks(
    {
      os: { id: 'os', size: '20G' },
      data: { vw: { id: 'vw', mount: '/vw', fs: 'xfs', size: '2G' } },
      tanks: {
        tank: {
          id: 'tank',
          mount: '/tank',
          options: {
            pool: { ashift: 12, autotrim: 'off', autoexpand: 'on', failmode: 'continue' },
            dataset: { compression: 'lz4', atime: 'off', xattr: 'sa', special_small_blocks: 0 },
            acl: { acltype: 'posix', aclmode: 'passthrough', aclinherit: 'passthrough' },
          },
          vdevs: {
            data0: {
              role: 'data',
              type: 'single',
              members: { 'rocky-data0': { id: 'rocky-data0', size: '2G' } },
            },
          },
        },
      },
    },
    platform,
  )
}

/** @type {string[]} */
const temps = []

afterEach(() => {
  // @ts-expect-error restore
  paths.getVms.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  util.requireBins.mockRestore?.()
  // @ts-expect-error restore
  zx.$.mockRestore?.()
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('disks', () => {
  test('vmPaths and persistentDisks from resolved members', () => {
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    const resolved = sampleResolved()
    const p = vmPaths('rocky', resolved)
    expect(p.os.path).toBe('/tmp/qctl-test/vms/rocky/os.qcow2')
    expect(p.attached.map((e) => e.id)).toEqual(['vw', 'rocky-data0'])
    expect(persistentDisks(p)).toContain(p.attached[0].path)
    expect(persistentDisks(p)).not.toContain(p.os.path)
  })

  test('ensureDisks dry-run returns paths without creating', async () => {
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    const log = spyOn(console, 'log').mockImplementation(() => {})
    const p = await ensureDisks({
      name: 'rocky',
      baseImage: '/tmp/base.qcow2',
      resolved: sampleResolved(),
      wipeOs: true,
      dryRun: true,
    })
    expect(p.dir).toBe('/tmp/qctl-test/vms/rocky')
    const msg = String(log.mock.calls[0]?.[0])
    expect(msg).toMatch(/would ensure/)
    expect(msg).toMatch(/wipe disks\.os/)
    expect(msg).not.toMatch(/wipe tank/)
  })

  test('ensureDisks wipeOs removes only OS qcow; keeps data + tank members', async () => {
    const root = makeTempDir()
    temps.push(root)
    const vms = join(root, 'vms')
    const vmDir = join(vms, 'rocky')
    mkdirSync(vmDir, { recursive: true })
    spyOn(paths, 'getVms').mockReturnValue(vms)
    spyOn(util, 'requireBins').mockResolvedValue(undefined)
    spyOn(console, 'log').mockImplementation(() => {})

    const os = join(vmDir, 'os.qcow2')
    const vw = join(vmDir, 'vw.qcow2')
    const tank = join(vmDir, 'rocky-data0.qcow2')
    writeFileSync(os, 'old-os')
    writeFileSync(vw, 'keep-vw')
    writeFileSync(tank, 'keep-tank')

    spyOn(zx, '$').mockImplementation(
      /** @type {typeof zx.$} */ (
        /** @type {never} */ (
          /**
           * @param {TemplateStringsArray} strings
           * @param {...unknown} values
           */
          (strings, ...values) => {
            const cmd = String.raw(strings, ...values)
            if (cmd.includes('qemu-img create') && cmd.includes('-b')) {
              const out = values[values.length - 1]
              if (typeof out === 'string') writeFileSync(out, 'new-os')
            }
            return Promise.resolve({ exitCode: 0 })
          }
        )
      ),
    )

    await ensureDisks({
      name: 'rocky',
      baseImage: join(root, 'base.qcow2'),
      resolved: sampleResolved(),
      wipeOs: true,
      wipeTank: false,
    })

    expect(existsSync(os)).toBe(true)
    expect(readFileSync(os, 'utf8')).toBe('new-os')
    expect(readFileSync(vw, 'utf8')).toBe('keep-vw')
    expect(readFileSync(tank, 'utf8')).toBe('keep-tank')
  })
})
