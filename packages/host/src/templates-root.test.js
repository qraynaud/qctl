import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  getScaffoldTemplatesRoot,
  isTemplatesRoot,
  workspaceTemplatesRoot,
} from './templates-root.js'
import { describe, expect, test } from 'bun:test'

describe('scaffold templates root', () => {
  test('workspace root has provision/common.yaml.njk', () => {
    const root = workspaceTemplatesRoot()
    expect(isTemplatesRoot(root)).toBe(true)
    expect(existsSync(join(root, 'provision', 'common.yaml.njk'))).toBe(true)
    expect(existsSync(join(root, 'new', 'README.md.njk'))).toBe(true)
  })

  test('getScaffoldTemplatesRoot resolves workspace in checkout', () => {
    expect(getScaffoldTemplatesRoot()).toBe(workspaceTemplatesRoot())
  })
})
