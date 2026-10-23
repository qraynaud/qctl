import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  LAB_PORT_PRESETS,
  applyNetworkingAnswers,
  defaultNetworkingAnswers,
  ipv4OverlayToPlain,
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

describe('topologyToPlain / ipv4OverlayToPlain', () => {
  test('emits lab presets without optional empties', () => {
    const answers = defaultNetworkingAnswers(true)
    const plain = topologyToPlain(answers.topology)
    expect(plain.ports).toEqual({ ...LAB_PORT_PRESETS })
    expect(plain.uplinks).toEqual({ eth0: { dhcp4: true } })
    expect(plain.vlans).toEqual({})
  })

  test('vlan overlay is ipv4-only', () => {
    expect(ipv4OverlayToPlain({ vlan2: '10.42.2.2' })).toEqual({
      vlans: { vlan2: { ipv4: '10.42.2.2' } },
    })
  })
})

describe('applyNetworkingAnswers', () => {
  test('shared → common.yaml + profile ipv4 overlay', () => {
    const root = join(makeTempDir(), 'net-shared')
    temps.push(join(root, '..'))
    mkdirSync(join(root, 'provision'), { recursive: true })

    const answers = defaultNetworkingAnswers(true)
    answers.topology.vlans = { vlan2: { id: 2, link: 'eth0' } }
    answers.ipv4ByProfile = { lab: { vlan2: '10.42.2.2' } }

    applyNetworkingAnswers(root, answers, {
      profiles: { lab: { env: 'dev', target: 'workstation' } },
      environments: { dev: {} },
    })

    const common = readFileSync(join(root, 'provision', 'common.yaml'), 'utf8')
    expect(common).toContain('networking:')
    expect(common).toContain('ssh:')
    expect(common).toContain('forward: 2222')
    expect(common).toContain('eth0:')
    expect(common).toContain('vlan2:')
    expect(common).toContain('id: 2')
    expect(common).not.toContain('ipv4:')

    const profile = readFileSync(join(root, 'provision', 'profile-lab.yaml'), 'utf8')
    expect(profile).toContain('networking:')
    expect(profile).toContain('vlan2:')
    expect(profile).toContain('ipv4: 10.42.2.2')
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
    expect(dev).toContain('uplinks:')
    expect(prod).toContain('ports:')
    expect(prod).toContain('cockpit:')
  })
})
