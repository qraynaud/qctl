import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import {
  QCTL_APP_PROXY_UNIT,
  QCTL_SUPERVISOR_UNIT,
  installQctlAppProxyUnits,
  installQctlSupervisorUnit,
  qctlAppProxyUnitText,
  qctlSupervisorUnitText,
} from './units.js'
import { describe, expect, test } from 'bun:test'

describe('qctl-supervisor unit', () => {
  test('unit text runs _internal_supervisor with RuntimeDirectory=qctl', () => {
    const text = qctlSupervisorUnitText({ qctlBin: '/usr/local/bin/qctl' })
    expect(text).toContain('ExecStart=/usr/local/bin/qctl _internal_supervisor')
    expect(text).toContain('RuntimeDirectory=qctl')
    expect(QCTL_SUPERVISOR_UNIT).toBe('qctl-supervisor.service')
  })

  test('seed first-boot unit matches qctlSupervisorUnitText()', () => {
    const seedPath = join(import.meta.dir, '../../../host/seed/first-boot/qctl-supervisor.service')
    expect(readFileSync(seedPath, 'utf8')).toBe(qctlSupervisorUnitText())
  })

  test('install writes system unit and daemon-reloads', async () => {
    const root = makeTempDir()
    const systemDir = join(root, 'system')
    /** @type {string[]} */
    const writes = []
    /** @type {string[][]} */
    const sysCalls = []

    await installQctlSupervisorUnit({
      systemUnitDir: systemDir,
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
    })

    expect(writes).toEqual([join(systemDir, QCTL_SUPERVISOR_UNIT)])
    expect(sysCalls).toEqual([['daemon-reload']])
    expect(readFileSync(writes[0], 'utf8')).toContain('/opt/qctl _internal_supervisor')
  })
})

describe('qctl-app@ units', () => {
  test('unit text is Type=notify with ExecStop --release', () => {
    const text = qctlAppProxyUnitText({ qctlBin: '/usr/local/bin/qctl' })
    expect(text).toContain('Type=notify')
    expect(text).toContain('NotifyAccess=all')
    expect(text).toContain('ExecStart=/usr/local/bin/qctl _internal_app_proxy %i')
    expect(text).toContain('ExecStop=/usr/local/bin/qctl _internal_app_proxy --release %i')
    expect(text).toContain('Wants=qctl-supervisor.service')
    expect(QCTL_APP_PROXY_UNIT).toBe('qctl-app@.service')
  })

  test('seed first-boot unit matches qctlAppProxyUnitText()', () => {
    const seedPath = join(import.meta.dir, '../../../host/seed/first-boot/qctl-app@.service')
    expect(readFileSync(seedPath, 'utf8')).toBe(qctlAppProxyUnitText())
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

    expect(readFileSync(writes[0], 'utf8')).toContain('/opt/qctl _internal_app_proxy %i')
  })
})
