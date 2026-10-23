import {
  collectEnvRefs,
  envRef,
  isEmptyCredential,
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

  test('parses !env mapping with encoding', () => {
    const doc = parseProvisionYaml(`
repo:
  deploy_key: !env { name: DEPLOY_KEY, encoding: base64 }
ssh:
  host_keys: !env
    name: SSH_HOST_KEYS
    encoding: base64
`)
    expect(collectEnvRefs(doc)).toEqual(['DEPLOY_KEY', 'SSH_HOST_KEYS'])
    const root = /** @type {YamlMapping} */ (/** @type {never} */ (doc))
    const repo = /** @type {YamlMapping} */ (root.repo)
    expect(isEnvRef(repo.deploy_key)).toBe(true)
    if (isEnvRef(repo.deploy_key)) {
      expect(repo.deploy_key.name).toBe('DEPLOY_KEY')
      expect(repo.deploy_key.encoding).toBe('base64')
    }
  })

  test('envRef helpers', () => {
    const ref = envRef('FOO')
    expect(ref.name).toBe('FOO')
    expect(ref.encoding).toBe('utf8')
    expect(isEnvRef(ref)).toBe(true)
    expect(isEnvRef({ name: 'FOO' })).toBe(false)
    expect(isEnvRef(null)).toBe(false)
    expect(envRef('FOO', 'base64').encoding).toBe('base64')
  })

  test('empty document becomes {}', () => {
    expect(parseProvisionYaml('')).toEqual({})
  })

  test('invalid yaml throws with source', () => {
    expect(() => parseProvisionYaml('foo: [unclosed', 'bad.yaml')).toThrow(/bad\.yaml/)
  })

  test('invalid !env encoding fails at parse', () => {
    expect(() => parseProvisionYaml('a: !env { name: FOO, encoding: rot13 }', 'bad.yaml')).toThrow(
      /encoding/,
    )
  })
})

describe('resolveEnvRefs', () => {
  test('resolves scalar !env to utf8 Buffer', () => {
    const doc = parseProvisionYaml(`a: !env FOO\nb: plain`)
    const out = /** @type {YamlMapping} */ (resolveEnvRefs(doc, { FOO: 'secret' }))
    expect(Buffer.isBuffer(out.a)).toBe(true)
    expect(out.a).toEqual(Buffer.from('secret', 'utf8'))
    expect(out.b).toBe('plain')
  })

  test('resolves mapping !env with base64 encoding', () => {
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nn\n-----END OPENSSH PRIVATE KEY-----\n'
    const doc = parseProvisionYaml(`k: !env { name: DEPLOY_KEY, encoding: base64 }`)
    const out = /** @type {YamlMapping} */ (
      resolveEnvRefs(doc, { DEPLOY_KEY: Buffer.from(pem, 'utf8').toString('base64') })
    )
    expect(out.k).toEqual(Buffer.from(pem, 'utf8'))
  })

  test('errors when missing; allows empty string as empty Buffer', () => {
    const doc = parseProvisionYaml(`a: !env MISSING`)
    expect(() => resolveEnvRefs(doc, {})).toThrow(/MISSING/)
    const out = /** @type {YamlMapping} */ (resolveEnvRefs(doc, { MISSING: '' }))
    expect(out.a).toEqual(Buffer.alloc(0))
    expect(isEmptyCredential(out.a)).toBe(true)
  })

  test('resolves inside arrays', () => {
    const doc = parseProvisionYaml(`keys:\n  - !env K1\n  - plain`)
    const out = /** @type {YamlMapping} */ (resolveEnvRefs(doc, { K1: 'v' }))
    expect(out.keys).toEqual([Buffer.from('v', 'utf8'), 'plain'])
  })
})

describe('isEmptyCredential', () => {
  test('treats null/empty string/empty Buffer as empty', () => {
    expect(isEmptyCredential(null)).toBe(true)
    expect(isEmptyCredential('')).toBe(true)
    expect(isEmptyCredential(Buffer.alloc(0))).toBe(true)
    expect(isEmptyCredential('x')).toBe(false)
    expect(isEmptyCredential(Buffer.from('x'))).toBe(false)
  })
})

describe('stripOppositeTarget', () => {
  test('drops proxmox on workstation target', () => {
    /** @type {YamlMapping} */
    const data = { workstation: { cpu: 2 }, proxmox: { node: 'pve' } }
    stripOppositeTarget(data, 'workstation')
    expect(data).toEqual({ workstation: { cpu: 2 } })
  })

  test('drops workstation on proxmox target', () => {
    /** @type {YamlMapping} */
    const data = { workstation: { cpu: 2 }, proxmox: { node: 'pve' } }
    stripOppositeTarget(data, 'proxmox')
    expect(data).toEqual({ proxmox: { node: 'pve' } })
  })
})
