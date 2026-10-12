import { formatChangelog } from './release-changelog.js'
import { describe, expect, test } from 'bun:test'

describe('formatChangelog', () => {
  test('one line per subject', () => {
    expect(formatChangelog(['feat: a', 'fix: b'])).toBe('- feat: a\n- fix: b')
  })

  test('empty range', () => {
    expect(formatChangelog([])).toMatch(/No commits/)
  })
})
