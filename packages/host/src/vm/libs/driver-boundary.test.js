/**
 * Invariants for the thin-driver boundary: resolveDriver only, no host id branches,
 * appliance vs init-tank as separate runners.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as driversIndex from '../drivers/index.js'
import { describe, expect, test } from 'bun:test'

const here = dirname(fileURLToPath(import.meta.url))

describe('thin driver boundary', () => {
  test('drivers index exports resolveDriver, not loadDriver', () => {
    expect(typeof driversIndex.resolveDriver).toBe('function')
    expect(/** @type {Record<string, unknown>} */ (driversIndex).loadDriver).toBeUndefined()
  })

  test('power-state / sync endpoint / target.js have no target=== or driver.id=== branches', () => {
    const roots = [
      join(here, 'power-state.js'),
      join(here, '../../sync/endpoint.js'),
      join(here, '../../lib/target.js'),
    ]
    for (const file of roots) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/target\s*===\s*['"]workstation['"]/)
      expect(src, file).not.toMatch(/target\s*===\s*['"]proxmox['"]/)
      expect(src, file).not.toMatch(/\.id\s*===\s*['"]workstation['"]/)
      expect(src, file).not.toMatch(/\.id\s*===\s*['"]proxmox['"]/)
    }
  })

  test('up-pipeline exports runVmInitTank separate from runVmUp', async () => {
    const pipe = await import('./up-pipeline.js')
    expect(typeof pipe.runVmUp).toBe('function')
    expect(typeof pipe.runVmInitTank).toBe('function')
    expect(pipe.runVmUp).not.toBe(pipe.runVmInitTank)
  })
})
