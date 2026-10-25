import { vmDriverIdSchema } from './id.js'
import { id as proxmoxId } from './proxmox.js'
import { id as workstationId } from './workstation.js'
import { describe, expect, test } from 'bun:test'

describe('vmDriverIdSchema', () => {
  test('parses and brands non-empty ids', () => {
    expect(String(vmDriverIdSchema.parse('workstation'))).toBe('workstation')
    expect(String(vmDriverIdSchema.parse('  proxmox  '))).toBe('proxmox')
  })

  test('rejects empty', () => {
    expect(() => vmDriverIdSchema.parse('')).toThrow()
    expect(() => vmDriverIdSchema.parse('   ')).toThrow()
  })
})

describe('driver modules own their id', () => {
  test('workstation and proxmox export branded ids', () => {
    expect(String(workstationId)).toBe('workstation')
    expect(String(proxmoxId)).toBe('proxmox')
    expect(workstationId).toBe(vmDriverIdSchema.parse('workstation'))
    expect(proxmoxId).toBe(vmDriverIdSchema.parse('proxmox'))
  })
})
