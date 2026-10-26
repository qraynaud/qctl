import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  LAB_PORT_PRESETS,
  applyNetworkingAnswers,
  defaultNetworkingAnswers,
  ethernetLabels,
  l3OverlayToPlain,
  normalizeIpv4Cidr,
  topologyToPlain,
} from './networking.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('topologyToPlain / l3OverlayToPlain', () => {
  test('emits lab presets + main ethernet with dhcp', () => {
    const answers = defaultNetworkingAnswers(true)
    const plain = topologyToPlain(answers.topology)
    expect(plain.ports).toEqual({ ...LAB_PORT_PRESETS })
    expect(plain.interfaces).toEqual({
      main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
    })
  })

  test('serializes optional ethernet.vm modes', () => {
    const plain = topologyToPlain({
      ports: {},
      interfaces: {
        main: {
          type: 'ethernet',
          iface: 'eth0',
          ipv4: { dhcp: true },
          vm: { mode: 'bridge', bridge: 'vmbr0', vlan: [2] },
        },
        lab: { type: 'ethernet', iface: 'eth1', vm: { mode: 'nat' } },
      },
    })
    expect(plain.interfaces?.main).toMatchObject({
      type: 'ethernet',
      vm: { mode: 'bridge', bridge: 'vmbr0', vlan: [2] },
    })
    expect(plain.interfaces?.lab).toMatchObject({
      type: 'ethernet',
      vm: { mode: 'nat' },
    })
  })

  test('l3 overlay is addresses-only under interfaces', () => {
    expect(l3OverlayToPlain({ vlan2: '10.42.2.2' })).toEqual({
      interfaces: { vlan2: { ipv4: { addresses: ['10.42.2.2/24'] } } },
    })
    expect(normalizeIpv4Cidr('10.0.0.1/32')).toBe('10.0.0.1/32')
  })

  test('ethernetLabels sorts ethernet keys', () => {
    expect(
      ethernetLabels({
        ports: {},
        interfaces: {
          z: { type: 'ethernet', iface: 'eth1' },
          a: { type: 'ethernet', iface: 'eth0' },
          vlan2: { type: 'dummy' },
        },
      }),
    ).toEqual(['a', 'z'])
  })
})

describe('applyNetworkingAnswers', () => {
  test('shared → common.yaml + profile L3 overlay', () => {
    const root = join(makeTempDir(), 'net-shared')
    temps.push(join(root, '..'))
    mkdirSync(join(root, 'provision'), { recursive: true })

    const answers = defaultNetworkingAnswers(true)
    answers.topology.interfaces.vlan2 = { type: 'dummy' }
    answers.l3ByProfile = { lab: { vlan2: '10.42.2.2' } }

    applyNetworkingAnswers(root, answers, {
      profiles: { lab: { env: 'dev', target: 'workstation' } },
      environments: { dev: {} },
    })

    const common = readFileSync(join(root, 'provision', 'common.yaml'), 'utf8')
    expect(common).toContain('networking:')
    expect(common).toContain('ssh:')
    expect(common).toContain('forward: 2222')
    expect(common).toContain('main:')
    expect(common).toContain('iface: eth0')
    expect(common).toContain('vlan2:')
    expect(common).toContain('type: dummy')
    expect(common).not.toContain('addresses:')

    const profile = readFileSync(join(root, 'provision', 'profile-lab.yaml'), 'utf8')
    expect(profile).toContain('networking:')
    expect(profile).toContain('vlan2:')
    expect(profile).toContain('addresses:')
    expect(profile).toContain('10.42.2.2/24')
    expect(profile).not.toContain('ports:')
  })

  test('not shared → env-*.yaml base networking', () => {
    const root = join(makeTempDir(), 'net-env')
    temps.push(join(root, '..'))
    mkdirSync(join(root, 'provision'), { recursive: true })

    const answers = defaultNetworkingAnswers(false)
    applyNetworkingAnswers(root, answers, {
      profiles: {
        lab: { env: 'dev', target: 'workstation' },
        pve: { env: 'prod', target: 'proxmox' },
      },
      environments: { dev: {}, prod: {} },
    })

    const dev = readFileSync(join(root, 'provision', 'env-dev.yaml'), 'utf8')
    const prod = readFileSync(join(root, 'provision', 'env-prod.yaml'), 'utf8')
    expect(dev).toContain('ports:')
    expect(dev).toContain('interfaces:')
    expect(dev).toContain('main:')
    expect(prod).toContain('ports:')
    expect(prod).toContain('cockpit:')
  })
})
