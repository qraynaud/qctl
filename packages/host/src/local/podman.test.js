import { stripPodmanNoise } from './podman.js'
import { describe, expect, test } from 'bun:test'

describe('stripPodmanNoise', () => {
  test('removes known graph-driver / dbus spam lines', () => {
    const raw = [
      'User-selected graph driver "overlay"',
      'useful line',
      'Failed to connect to system scope bus',
      'ok',
    ].join('\n')
    expect(stripPodmanNoise(raw)).toBe('useful line\nok')
  })

  test('handles empty input', () => {
    expect(stripPodmanNoise('')).toBe('')
    expect(stripPodmanNoise(/** @type {string} */ (/** @type {string | null} */ (null)))).toBe('')
  })
})
