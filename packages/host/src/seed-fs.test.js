import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { copySeedKit } from './seed-fs.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

/**
 * @param {string} root
 */
function writeMinimalSeed(root) {
  for (const name of ['cloud-init', 'first-boot', 'lib']) {
    mkdirSync(join(root, name), { recursive: true })
  }
  writeFileSync(join(root, 'cloud-init', 'user-data.yaml'), '#cloud-config\n')
  writeFileSync(join(root, 'lib', 'note.txt'), 'ok\n')
}

describe('copySeedKit', () => {
  test('copies cloud-init/first-boot/lib into dest', () => {
    const src = makeTempDir()
    const dest = makeTempDir()
    temps.push(src, dest)
    writeMinimalSeed(src)
    copySeedKit(src, dest)
    expect(existsSync(join(dest, 'cloud-init', 'user-data.yaml'))).toBe(true)
    expect(existsSync(join(dest, 'lib', 'note.txt'))).toBe(true)
  })

  test('throws when a required tree is missing', () => {
    const src = makeTempDir()
    const dest = makeTempDir()
    temps.push(src, dest)
    mkdirSync(join(src, 'cloud-init'), { recursive: true })
    expect(() => copySeedKit(src, dest)).toThrow(/seed kit missing/)
  })
})
