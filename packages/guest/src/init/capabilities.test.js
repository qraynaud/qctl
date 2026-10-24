import { capabilitiesForProfile } from './capabilities.js'
import { describe, expect, test } from 'bun:test'

describe('capabilitiesForProfile', () => {
  test('without disks: no zfs / fs caps', () => {
    expect(capabilitiesForProfile('init-tank')).toEqual(['curl', 'jq', 'unzip', 'host-tools'])
  })

  test('init-tank + disks: fs union + zfs iff tanks', () => {
    expect(
      capabilitiesForProfile('init-tank', {
        disks: { filesystems: ['xfs', 'ext4'], hasTanks: true },
      }),
    ).toEqual(['curl', 'jq', 'unzip', 'host-tools', 'xfs', 'ext4', 'zfs'])
    expect(
      capabilitiesForProfile('init-tank', {
        disks: { filesystems: ['xfs'], hasTanks: false },
      }),
    ).toEqual(['curl', 'jq', 'unzip', 'host-tools', 'xfs'])
  })

  test('default + hg requests mercurial (not git)', () => {
    const caps = capabilitiesForProfile('default', {
      vcs: 'hg',
      disks: { filesystems: ['xfs'], hasTanks: true },
    })
    expect(caps).toContain('cockpit')
    expect(caps).toContain('mercurial')
    expect(caps).toContain('xfs')
    expect(caps).toContain('zfs')
    expect(caps).not.toContain('git')
  })

  test('default + git includes git', () => {
    expect(
      capabilitiesForProfile('default', {
        vcs: 'git',
        disks: { filesystems: [], hasTanks: false },
      }),
    ).toContain('git')
  })
})
