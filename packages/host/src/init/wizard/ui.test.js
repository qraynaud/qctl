import { wizardScopePrefix, wizardScoped } from './ui.js'
import { describe, expect, test } from 'bun:test'

describe('wizardScopePrefix / wizardScoped', () => {
  test('empty scope → no prefix', () => {
    expect(wizardScopePrefix({})).toBe('')
    expect(wizardScopePrefix(null)).toBe('')
    expect(wizardScoped({}, 'Add a tank?')).toBe('Add a tank?')
  })

  test('env → profile → target order when several set', () => {
    expect(
      wizardScopePrefix({
        target: 'workstation',
        env: 'dev',
        profile: 'lab',
      }),
    ).toBe('[env:dev] [profile:lab] [target:workstation]')
  })

  test('prefixes message with the configured subject only', () => {
    expect(wizardScoped({ profile: 'prod' }, 'Target')).toBe('[profile:prod] Target')
    expect(wizardScoped({ env: 'prod' }, 'Mark as production?')).toBe(
      '[env:prod] Mark as production?',
    )
  })
})
