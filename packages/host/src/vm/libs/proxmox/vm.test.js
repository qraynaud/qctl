import {
  createAndStartRockyVm,
  destroyRockyVm,
  detachAndDeleteSeedIso,
  ensureCloudImageImport,
  reconcileRockyAppliance,
  restoreProxmoxDisplay,
  sizeToGiB,
  uploadSeedIso,
  waitUntilVmStopped,
} from './vm.js'
import { describe, expect, test } from 'bun:test'

describe('proxmox vm barrel', () => {
  test('re-exports lifecycle and image helpers', () => {
    expect(typeof sizeToGiB).toBe('function')
    expect(typeof ensureCloudImageImport).toBe('function')
    expect(typeof uploadSeedIso).toBe('function')
    expect(typeof detachAndDeleteSeedIso).toBe('function')
    expect(typeof restoreProxmoxDisplay).toBe('function')
    expect(typeof createAndStartRockyVm).toBe('function')
    expect(typeof destroyRockyVm).toBe('function')
    expect(typeof waitUntilVmStopped).toBe('function')
    expect(typeof reconcileRockyAppliance).toBe('function')
  })
})
