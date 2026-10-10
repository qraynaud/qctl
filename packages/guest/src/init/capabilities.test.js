import { capabilitiesForProfile } from './capabilities.js'
import { describe, expect, test } from 'bun:test'

describe('capabilitiesForProfile', () => {
  test('init-tank is storage-only', () => {
    expect(capabilitiesForProfile('init-tank')).toEqual(['curl', 'jq', 'unzip', 'zfs', 'xfsprogs'])
  })

  test('default + hg requests mercurial (not git)', () => {
    const caps = capabilitiesForProfile('default', { vcs: 'hg' })
    expect(caps).toContain('cockpit')
    expect(caps).toContain('mercurial')
    expect(caps).not.toContain('git')
  })

  test('default + git includes git', () => {
    expect(capabilitiesForProfile('default', { vcs: 'git' })).toContain('git')
  })
})
