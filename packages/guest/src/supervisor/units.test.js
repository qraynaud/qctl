import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import { QCTL_APP_PROXY_UNIT, installQctlAppProxyUnits, qctlAppProxyUnitText } from './units.js'
import { describe, expect, test } from 'bun:test'

describe('qctl-app@ units', () => {
  test('unit text is Type=notify with ExecStop --release', () => {
    const text = qctlAppProxyUnitText({ qctlBin: '/usr/local/bin/qctl' })
    expect(text).toContain('Type=notify')
    expect(text).toContain('ExecStart=/usr/local/bin/qctl _internal_app_proxy %i')
    expect(text).toContain('ExecStop=/usr/local/bin/qctl _internal_app_proxy --release %i')
    expect(QCTL_APP_PROXY_UNIT).toBe('qctl-app@.service')
  })

  test('install writes system+user units and daemon-reloads both buses', async () => {
    const root = makeTempDir()
    const systemDir = join(root, 'system')
    const userDir = join(root, 'user')
    /** @type {string[]} */
    const writes = []
    /** @type {string[][]} */
    const sysCalls = []
    /** @type {string[][]} */
    const userCalls = []

    await installQctlAppProxyUnits({
      systemUnitDir: systemDir,
      userUnitDir: userDir,
      qctlBin: '/opt/qctl',
      mkdir: async (p) => {
        const { mkdirSync } = await import('node:fs')
        mkdirSync(p, { recursive: true })
      },
      writeFile: async (p, body) => {
        const { writeFileSync } = await import('node:fs')
        writeFileSync(p, body)
        writes.push(p)
      },
      systemctl: (args) => {
        sysCalls.push(args)
        return { status: 0 }
      },
      systemctlUser: (args) => {
        userCalls.push(args)
        return { status: 0 }
      },
    })

    expect(writes).toEqual([
      join(systemDir, QCTL_APP_PROXY_UNIT),
      join(userDir, QCTL_APP_PROXY_UNIT),
    ])
    expect(sysCalls).toEqual([['daemon-reload']])
    expect(userCalls).toEqual([['daemon-reload']])

    const { readFileSync } = await import('node:fs')
    expect(readFileSync(writes[0], 'utf8')).toContain('/opt/qctl _internal_app_proxy %i')
  })
})
