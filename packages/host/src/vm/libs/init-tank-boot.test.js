import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as zx from 'zx'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import * as paths from '../../lib/paths.js'
import * as util from '../../lib/util.js'
import {
  INIT_TANK_BOOT_ID,
  ensureInitTankBootDisk,
  initTankBootQcowPath,
  removeInitTankBootDisk,
} from './init-tank-boot.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  // @ts-expect-error restore
  paths.getVms.mockRestore?.()
  // @ts-expect-error restore
  util.requireBins.mockRestore?.()
  // @ts-expect-error restore
  zx.$.mockRestore?.()
  while (temps.length) {
    const d = temps.pop()
    if (d) removeTempDir(d)
  }
})

describe('init-tank-boot', () => {
  test('initTankBootQcowPath nests under getVms()', () => {
    spyOn(paths, 'getVms').mockReturnValue('/vms')
    expect(initTankBootQcowPath('rocky')).toBe(`/vms/rocky/${INIT_TANK_BOOT_ID}.qcow2`)
  })

  test('ensureInitTankBootDisk creates overlay; removeInitTankBootDisk deletes it', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const vms = join(dir, 'vms')
    const base = join(dir, 'base.qcow2')
    writeFileSync(base, 'base')
    spyOn(paths, 'getVms').mockReturnValue(vms)
    spyOn(util, 'requireBins').mockResolvedValue(undefined)
    /** @type {string[]} */
    const cmds = []
    spyOn(zx, '$').mockImplementation(
      /** @type {typeof zx.$} */ (
        /** @type {never} */ (
          /**
           * @param {TemplateStringsArray} strings
           * @param {...unknown} values
           */
          (strings, ...values) => {
            const cmd = String.raw(strings, ...values)
            cmds.push(cmd)
            if (cmd.includes('qemu-img create') && cmd.includes('-b')) {
              const out = values[values.length - 1]
              if (typeof out === 'string') writeFileSync(out, 'boot')
            }
            return Promise.resolve({ exitCode: 0 })
          }
        )
      ),
    )

    const boot = await ensureInitTankBootDisk({ name: 'demo', baseImage: base, size: '128M' })
    expect(boot).toBe(join(vms, 'demo', `${INIT_TANK_BOOT_ID}.qcow2`))
    expect(existsSync(boot)).toBe(true)
    expect(
      cmds.some((c) => c.includes('qemu-img create') && c.includes(base) && c.includes(boot)),
    ).toBe(true)
    expect(
      cmds.some((c) => c.includes('qemu-img resize') && c.includes(boot) && c.includes('128M')),
    ).toBe(true)

    expect(await removeInitTankBootDisk('demo')).toBe(true)
    expect(existsSync(boot)).toBe(false)
    expect(await removeInitTankBootDisk('demo')).toBe(false)
  })
})
