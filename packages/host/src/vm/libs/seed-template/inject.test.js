import { injectProvisionFiles } from './inject.js'
import { describe, expect, test } from 'bun:test'

/** @import { YamlMapping } from '@qctl/shared' */

/**
 * @typedef {{
 *   path?: string,
 *   content?: string,
 *   encoding?: string,
 *   permissions?: string,
 * } & YamlMapping} WriteFile
 */

/**
 * @param {YamlMapping} userData
 * @returns {WriteFile[]}
 */
function writeFilesOf(userData) {
  return Array.isArray(userData.write_files)
    ? /** @type {WriteFile[]} */ (userData.write_files)
    : []
}

describe('injectProvisionFiles', () => {
  test('merges files and ensures trailing newline', () => {
    const userData = {
      write_files: [{ path: '/etc/a', content: 'old\n' }],
    }
    const out = injectProvisionFiles(userData, [
      { path: '/etc/a', content: 'new' },
      { path: '/etc/b', content: 'b\n', owner: 'root:root', permissions: '0600' },
    ])
    const a = writeFilesOf(out).find((w) => w.path === '/etc/a')
    const b = writeFilesOf(out).find((w) => w.path === '/etc/b')
    expect(a?.content).toBe('new\n')
    expect(b?.content).toBe('b\n')
    expect(b?.permissions).toBe('0600')
  })
})
