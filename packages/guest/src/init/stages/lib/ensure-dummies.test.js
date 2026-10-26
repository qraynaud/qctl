import { dummyNamesFromSeed, ensureDummiesScript, ensureDummiesUnitText } from './ensure-dummies.js'
import { describe, expect, test } from 'bun:test'

describe('dummyNamesFromSeed', () => {
  test('lists type:dummy ifaces sorted; ignores ethernet/vlan', () => {
    expect(
      dummyNamesFromSeed({
        main: { type: 'ethernet', iface: 'eth0' },
        apps: { type: 'vlan', iface: 'eth0.2', id: 2, parent: 'main' },
        lab: { type: 'dummy', iface: 'lab0' },
        vlan2: { type: 'dummy', iface: 'vlan2' },
      }),
    ).toEqual(['lab0', 'vlan2'])
  })

  test('empty when missing', () => {
    expect(dummyNamesFromSeed(undefined)).toEqual([])
    expect(dummyNamesFromSeed({})).toEqual([])
  })
})

describe('ensureDummiesScript / unit', () => {
  test('script references list path', () => {
    const sh = ensureDummiesScript('/usr/local/lib/qctl/dummies.list')
    expect(sh).toContain('/usr/local/lib/qctl/dummies.list')
    expect(sh).toContain('type dummy')
  })

  test('unit runs script before network-pre', () => {
    const unit = ensureDummiesUnitText('/usr/local/lib/qctl/ensure-dummies.sh')
    expect(unit).toContain('ExecStart=/usr/local/lib/qctl/ensure-dummies.sh')
    expect(unit).toContain('Before=network-pre.target')
  })
})
