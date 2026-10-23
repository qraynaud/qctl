import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  applyOverlaysAnswers,
  defaultProxmoxOverlay,
  defaultWorkstationOverlay,
  expandTrunkIds,
  parseTrunksInput,
  proxmoxToPlain,
  validateNetCarriesVlans,
  vlanIdsForUplink,
  workstationToPlain,
} from './overlays.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('parseTrunksInput / expandTrunkIds', () => {
  test('parses ids and ranges', () => {
    expect(parseTrunksInput('2, 10-12, 20')).toEqual([2, '10-12', 20])
    expect(expandTrunkIds([2, '10-12', 20])).toEqual([2, 10, 11, 12, 20])
  })

  test('rejects bad input', () => {
    expect(parseTrunksInput('')).toMatch(/At least one/)
    expect(parseTrunksInput('20-10')).toMatch(/Bad trunk range/)
  })
})

describe('vlan carriage', () => {
  test('vlanIdsForUplink uses link / sole uplink', () => {
    const topology = {
      ports: {},
      uplinks: { eth0: { dhcp4: true } },
      vlans: { vlan2: { id: 2, link: 'eth0' }, vlan5: { id: 5 } },
    }
    expect(vlanIdsForUplink(topology, 'eth0')).toEqual([2, 5])
    expect(vlanIdsForUplink(topology, 'eth1')).toEqual([])
  })

  test('validateNetCarriesVlans', () => {
    expect(validateNetCarriesVlans({ bridge: 'vmbr0', tag: 2 }, [2])).toBeUndefined()
    expect(
      validateNetCarriesVlans({ bridge: 'vmbr0', trunks: [2, '10-11'] }, [2, 11]),
    ).toBeUndefined()
    expect(validateNetCarriesVlans({ bridge: 'vmbr0' }, [2])).toMatch(/Must carry/)
  })
})

describe('plain + apply', () => {
  test('workstationToPlain', () => {
    expect(workstationToPlain(defaultWorkstationOverlay())).toEqual({
      workstation: { cpu: 2, memory: 4096 },
    })
  })

  test('proxmoxToPlain uses marker for secret token', () => {
    const pve = defaultProxmoxOverlay(['eth0'])
    pve.net.eth0 = { bridge: 'vmbr0', trunks: [2] }
    const plain = proxmoxToPlain(pve)
    expect(plain.proxmox).toMatchObject({
      api_url: 'https://pve.example:8006',
      node: 'pve',
      api_token: '__API_TOKEN__',
      net: { eth0: { bridge: 'vmbr0', trunks: [2] } },
    })
  })

  test('applyOverlaysAnswers writes target yaml + secret schema', () => {
    const root = join(makeTempDir(), 'ov')
    temps.push(join(root, '..'))
    mkdirSync(join(root, 'provision'), { recursive: true })

    const pve = defaultProxmoxOverlay(['eth0'])
    pve.apiToken = {
      kind: 'secret',
      name: 'PROXMOX_API_TOKEN',
      encoding: 'utf8',
      value: 'root@pam!qctl=secret',
    }
    pve.net.eth0 = { bridge: 'vmbr1', tag: 2 }

    applyOverlaysAnswers(
      root,
      {
        workstation: { cpu: 4, memory: 8192 },
        proxmox: pve,
      },
      {
        profiles: {
          lab: { env: 'dev', target: 'workstation' },
          pve: { env: 'prod', target: 'proxmox' },
        },
      },
    )

    const ws = readFileSync(join(root, 'provision', 'target-workstation.yaml'), 'utf8')
    expect(ws).toContain('cpu: 4')
    expect(ws).toContain('memory: 8192')

    const px = readFileSync(join(root, 'provision', 'target-proxmox.yaml'), 'utf8')
    expect(px).toContain('api_url:')
    expect(px).toContain('!env PROXMOX_API_TOKEN')
    expect(px).toContain('bridge: vmbr1')
    expect(px).toContain('tag: 2')
    expect(px).not.toContain('__API_TOKEN__')

    const schema = readFileSync(join(root, 'provision', '.env.schema'), 'utf8')
    expect(schema).toMatch(/PROXMOX_API_TOKEN/)
    const env = readFileSync(join(root, 'provision', '.env.prod'), 'utf8')
    expect(env).toContain('PROXMOX_API_TOKEN=root@pam!qctl=secret')
  })
})
