import {
  collectEnvRefs,
  envRef,
  isEnvRef,
  parseProvisionYaml,
  resolveEnvRefs,
  stripOppositeTarget,
} from './yaml.js'
import { describe, expect, test } from 'bun:test'

/** @import { YamlMapping } from '../yaml.js' */

describe('parseProvisionYaml / !env', () => {
  test('parses !env scalars', () => {
    const doc = parseProvisionYaml(`
qctl:
  platform: rocky
vaultwarden:
  client_id: !env VW_CLIENT_ID
  nested:
    token: !env VW_TOKEN
`)
    expect(collectEnvRefs(doc)).toEqual(['VW_CLIENT_ID', 'VW_TOKEN'])
  })

  test('envRef helpers', () => {
    const ref = envRef('FOO')
    expect(ref.name).toBe('FOO')
    expect(isEnvRef(ref)).toBe(true)
    expect(isEnvRef({ name: 'FOO' })).toBe(false)
    expect(isEnvRef(null)).toBe(false)
  })

  test('empty document becomes {}', () => {
    expect(parseProvisionYaml('')).toEqual({})
  })

  test('invalid yaml throws with source', () => {
    expect(() => parseProvisionYaml('foo: [unclosed', 'bad.yaml')).toThrow(/bad\.yaml/)
  })
})

describe('resolveEnvRefs', () => {
  test('resolves from process env', () => {
    const doc = parseProvisionYaml(`a: !env FOO\nb: plain`)
    expect(resolveEnvRefs(doc, { FOO: 'secret' })).toEqual({ a: 'secret', b: 'plain' })
  })

  test('errors when missing; allows empty string', () => {
    const doc = parseProvisionYaml(`a: !env MISSING`)
    expect(() => resolveEnvRefs(doc, {})).toThrow(/MISSING/)
    expect(resolveEnvRefs(doc, { MISSING: '' })).toEqual({ a: '' })
  })

  test('resolves inside arrays', () => {
    const doc = parseProvisionYaml(`keys:\n  - !env K1\n  - plain`)
    expect(resolveEnvRefs(doc, { K1: 'v' })).toEqual({ keys: ['v', 'plain'] })
  })
})

describe('stripOppositeTarget', () => {
  test('drops proxmox on local target', () => {
    /** @type {YamlMapping} */
    const data = { local: { cpu: 2 }, proxmox: { node: 'pve' } }
    stripOppositeTarget(data, 'local')
    expect(data).toEqual({ local: { cpu: 2 } })
  })

  test('drops local on proxmox target', () => {
    /** @type {YamlMapping} */
    const data = { local: { cpu: 2 }, proxmox: { node: 'pve' } }
    stripOppositeTarget(data, 'proxmox')
    expect(data).toEqual({ proxmox: { node: 'pve' } })
  })
})
