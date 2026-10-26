import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  applyOverlaysAnswers,
  defaultProxmoxOverlay,
  defaultWorkstationOverlay,
  ifaceRemapsToPlain,
  proxmoxToPlain,
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

describe('plain serializers', () => {
  test('workstationToPlain', () => {
    expect(workstationToPlain(defaultWorkstationOverlay())).toEqual({
      workstation: { cpu: 2, memory: 4096 },
    })
  })

  test('proxmoxToPlain uses marker for secret token (no net)', () => {
    const pve = defaultProxmoxOverlay()
    const plain = proxmoxToPlain(pve)
    expect(plain.proxmox).toMatchObject({
      api_url: 'https://pve.example:8006',
      node: 'pve',
      cpu: 2,
      memory: 4096,
      api_token: '__API_TOKEN__',
    })
    expect(plain.proxmox).not.toHaveProperty('net')
  })

  test('ifaceRemapsToPlain', () => {
    expect(ifaceRemapsToPlain({ main: 'enp0s1' })).toEqual({
      interfaces: { main: { iface: 'enp0s1' } },
    })
  })
})

describe('applyOverlaysAnswers', () => {
  test('writes target yaml + secret schema + optional iface remaps', () => {
    const root = join(makeTempDir(), 'ov')
    temps.push(join(root, '..'))
    mkdirSync(join(root, 'provision'), { recursive: true })

    const pve = defaultProxmoxOverlay()
    pve.apiToken = {
      kind: 'secret',
      name: 'PROXMOX_API_TOKEN',
      encoding: 'utf8',
      value: 'root@pam!qctl=secret',
    }
    pve.storage = 'local-lvm'

    applyOverlaysAnswers(
      root,
      {
        workstation: { cpu: 4, memory: 8192 },
        proxmox: pve,
        ifaceRemapsByTarget: {
          proxmox: { main: 'enp0s1' },
        },
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
    expect(ws).not.toContain('networking:')

    const px = readFileSync(join(root, 'provision', 'target-proxmox.yaml'), 'utf8')
    expect(px).toContain('api_url:')
    expect(px).toContain('!env PROXMOX_API_TOKEN')
    expect(px).toContain('storage: local-lvm')
    expect(px).toContain('networking:')
    expect(px).toContain('main:')
    expect(px).toContain('iface: enp0s1')
    expect(px).not.toContain('net:')
    expect(px).not.toContain('bridge:')
    expect(px).not.toContain('__API_TOKEN__')

    const schema = readFileSync(join(root, 'provision', '.env.schema'), 'utf8')
    expect(schema).toMatch(/PROXMOX_API_TOKEN/)
    const env = readFileSync(join(root, 'provision', '.env.prod'), 'utf8')
    expect(env).toContain('PROXMOX_API_TOKEN=root@pam!qctl=secret')
  })
})
