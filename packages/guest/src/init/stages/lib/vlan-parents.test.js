import {
  ensureVlanParentsScript,
  labDummyParentsFromMap,
  vlanParentsUnitText,
} from './vlan-parents.js'
import { describe, expect, test } from 'bun:test'

describe('labDummyParentsFromMap', () => {
  test('picks vlanN PARENT values only', () => {
    expect(
      labDummyParentsFromMap({
        VLAN2_PARENT: 'vlan2',
        VLAN2_IPV4: '10.42.2.2',
        VLAN3_PARENT: 'bond0',
        OTHER: 'vlan9',
      }),
    ).toEqual(['vlan2'])
  })

  test('dedupes and sorts', () => {
    expect(
      labDummyParentsFromMap({
        VLAN10_PARENT: 'vlan10',
        VLAN2_PARENT: 'vlan2',
        VLAN2_PARENT_DUP: 'nope',
      }),
    ).toEqual(['vlan10', 'vlan2'])
  })
})

describe('ensureVlanParentsScript / unit', () => {
  test('script references env path', () => {
    const sh = ensureVlanParentsScript('/usr/local/lib/rocky/vlan-parents.env')
    expect(sh).toContain('/usr/local/lib/rocky/vlan-parents.env')
    expect(sh).toContain('type dummy')
  })

  test('unit runs script before network-pre', () => {
    const unit = vlanParentsUnitText('/usr/local/lib/qctl/ensure-vlan-parents.sh')
    expect(unit).toContain('ExecStart=/usr/local/lib/qctl/ensure-vlan-parents.sh')
    expect(unit).toContain('Before=network-pre.target')
  })
})
