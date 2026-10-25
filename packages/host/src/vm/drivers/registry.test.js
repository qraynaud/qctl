import { vmDriverIdSchema } from './id.js'
import { module as proxmoxModule } from './proxmox.js'
import {
  _resetDriverRegistryForTests,
  asVmDriverId,
  getDriverModule,
  listDriverIds,
  registerDriver,
} from './registry.js'
import { module as workstationModule } from './workstation.js'
import { beforeEach, describe, expect, spyOn, test } from 'bun:test'

beforeEach(() => {
  _resetDriverRegistryForTests()
  registerDriver(workstationModule)
  registerDriver(proxmoxModule)
})

describe('driver registry', () => {
  test('listDriverIds includes builtins', () => {
    const ids = listDriverIds().map(String).sort()
    expect(ids).toEqual(['proxmox', 'workstation'])
  })

  test('getDriverModule returns registration', () => {
    expect(getDriverModule(workstationModule.id)?.id).toBe(workstationModule.id)
    expect(getDriverModule('missing')).toBeUndefined()
  })

  test('asVmDriverId brands known ids and dies on unknown', () => {
    expect(asVmDriverId('workstation')).toBe(workstationModule.id)
    spyOn(process, 'exit').mockImplementation(
      /** @returns {never} */ () => {
        throw new Error('exit')
      },
    )
    spyOn(console, 'error').mockImplementation(() => {})
    expect(() => asVmDriverId('nope')).toThrow(/exit/)
  })

  test('registerDriver rejects duplicates', () => {
    spyOn(process, 'exit').mockImplementation(
      /** @returns {never} */ () => {
        throw new Error('exit')
      },
    )
    spyOn(console, 'error').mockImplementation(() => {})
    expect(() => registerDriver(workstationModule)).toThrow(/exit/)
  })

  test('asVmDriverId rejects empty', () => {
    spyOn(process, 'exit').mockImplementation(
      /** @returns {never} */ () => {
        throw new Error('exit')
      },
    )
    spyOn(console, 'error').mockImplementation(() => {})
    expect(() => asVmDriverId('')).toThrow(/exit/)
  })
})

describe('registerDriver isolation', () => {
  test('can register a third id after reset', () => {
    _resetDriverRegistryForTests()
    const id = vmDriverIdSchema.parse('lab')
    registerDriver({ id, defaultVmName: () => 'rocky-lab' })
    expect(String(getDriverModule(id)?.id)).toBe('lab')
    expect(listDriverIds().map(String)).toEqual(['lab'])
  })
})
