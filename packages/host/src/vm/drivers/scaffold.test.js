import { vmDriverIdSchema } from './id.js'
import { module as proxmoxModule } from './proxmox.js'
import { _unregisterDriverForTests, getDriverModule, registerDriver } from './registry.js'
import {
  assertScaffoldTarget,
  isKnownScaffoldTarget,
  listScaffoldTargets,
  resolveTargetYamlStub,
  scaffoldHintFor,
} from './scaffold.js'
import { module as workstationModule } from './workstation.js'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

/** Keep builtins (do not clear the whole registry — parse.js already evaluated). */
beforeEach(() => {
  _unregisterDriverForTests('lab')
  if (!getDriverModule(workstationModule.id)) registerDriver(workstationModule)
  if (!getDriverModule(proxmoxModule.id)) registerDriver(proxmoxModule)
})

afterEach(() => {
  _unregisterDriverForTests('lab')
})

describe('scaffold targets from driver registry', () => {
  test('listScaffoldTargets matches registered builtins', () => {
    expect(listScaffoldTargets()).toEqual(['proxmox', 'workstation'])
  })

  test('assertScaffoldTarget rejects unknown ids', () => {
    expect(() => assertScaffoldTarget('nope')).toThrow(/want proxmox\|workstation/)
  })

  test('resolveTargetYamlStub uses Nunjucks / module for builtins', () => {
    const ws = resolveTargetYamlStub('workstation')
    expect(ws).toMatch(/workstation:/)
    expect(ws).toMatch(/cpu:/)
    const px = resolveTargetYamlStub('proxmox')
    expect(px).toMatch(/proxmox:/)
    expect(px).toMatch(/api_url:/)
  })

  test('scaffoldHintFor reads module.scaffoldHint', () => {
    expect(scaffoldHintFor('workstation')).toBe('VM on this machine')
    expect(scaffoldHintFor('proxmox')).toBe('remote Proxmox VE')
  })

  test('third registered driver stubs via scaffoldTargetYaml', () => {
    const id = vmDriverIdSchema.parse('lab')
    registerDriver({
      id,
      scaffoldHint: 'lab hypervisor',
      scaffoldTargetYaml: () => 'lab:\n  slot: 1\n',
      provisionOverlaySchema: workstationModule.provisionOverlaySchema,
    })
    expect(isKnownScaffoldTarget('lab')).toBe(true)
    expect(listScaffoldTargets()).toContain('lab')
    expect(scaffoldHintFor('lab')).toBe('lab hypervisor')
    expect(resolveTargetYamlStub('lab')).toBe('lab:\n  slot: 1\n')
  })
})
