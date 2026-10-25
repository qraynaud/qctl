import { printVmStatusSnapshot, runVmSshInfo, runVmStatus } from './status-pipeline.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmContext, VmStatusSnapshot } from '../driver-contract.js' */

afterEach(() => {
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('printVmStatusSnapshot', () => {
  test('prints summary fields disks and hints', () => {
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.map(String).join(' '))
    })
    /** @type {VmStatusSnapshot} */
    const snap = {
      power: { kind: 'running', detail: 'running' },
      summary: 'Id: 1\nName: rocky',
      fields: { cpus: 2 },
      disks: [{ id: 'os', path: '/vms/rocky/os.qcow2', exists: true }],
      hints: { title: 'Shell', lines: ['qctl vm shell'] },
    }
    printVmStatusSnapshot(snap)
    const joined = lines.join('\n')
    expect(joined).toMatch(/Name: rocky/)
    expect(joined).toMatch(/cpus: 2/)
    expect(joined).toMatch(/os:/)
    expect(joined).toMatch(/qctl vm shell/)
  })

  test('hintsOnly skips summary', () => {
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.map(String).join(' '))
    })
    printVmStatusSnapshot(
      {
        power: { kind: 'absent' },
        summary: 'should not print',
        hints: { title: 'Shell', lines: ['only hints'] },
      },
      { hintsOnly: true },
    )
    const joined = lines.join('\n')
    expect(joined).not.toMatch(/should not print/)
    expect(joined).toMatch(/only hints/)
  })
})

describe('runVmStatus / runVmSshInfo', () => {
  test('runVmStatus delegates to getStatus then prints', async () => {
    spyOn(console, 'log').mockImplementation(() => {})
    let called = false
    await runVmStatus(
      /** @type {VmContext} */ ({
        name: 'rocky',
        env: 'dev',
        timeout: 1,
        dryRun: false,
      }),
      {
        id: /** @type {never} */ ('workstation'),
        getStatus: async () => {
          called = true
          return {
            power: { kind: 'absent' },
            summary: 'domain rocky not defined',
          }
        },
      },
    )
    expect(called).toBe(true)
  })

  test('runVmSshInfo prints hints only', async () => {
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.map(String).join(' '))
    })
    await runVmSshInfo(
      /** @type {VmContext} */ ({
        name: 'rocky',
        env: 'dev',
        timeout: 1,
        dryRun: false,
      }),
      {
        id: /** @type {never} */ ('proxmox'),
        getStatus: async () => ({
          power: { kind: 'running' },
          summary: 'must not appear',
          hints: { title: 'Shell (Proxmox)', lines: ['qctl vm shell --host <ip>'] },
        }),
      },
    )
    const joined = lines.join('\n')
    expect(joined).not.toMatch(/must not appear/)
    expect(joined).toMatch(/qctl vm shell --host/)
  })
})
