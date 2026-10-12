import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyDnat, ensureUp, planApplyDnat, planEnsureUp, rockyNetworking } from './networking.js'
import { describe, expect, test } from 'bun:test'

describe('rocky networking', () => {
  test('plan helpers describe egress and DNAT', () => {
    const ctx = {
      env: { QCTL_EGRESS_HOST: '8.8.8.8', QCTL_EGRESS_IFACE: 'eth1' },
      log: () => {},
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    }
    expect(planEnsureUp(ctx)[0]).toMatch(/8\.8\.8\.8/)
    expect(planApplyDnat(ctx)[0]).toMatch(/dnat-apply/)
    expect(rockyNetworking.planEnsureUp).toBe(planEnsureUp)
  })

  test('ensureUp returns early when ping succeeds', async () => {
    /** @type {string[]} */
    const logs = []
    /** @type {string[][]} */
    const cmds = []
    await ensureUp({
      env: { QCTL_EGRESS_HOST: '1.1.1.1' },
      log: (l) => logs.push(l),
      exec: async (argv) => {
        cmds.push(argv)
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    expect(logs[0]).toMatch(/egress OK/)
    expect(cmds).toEqual([['ping', '-c1', '-W2', '1.1.1.1']])
  })

  test('applyDnat skips when script missing', async () => {
    /** @type {string[]} */
    const logs = []
    await applyDnat({
      env: { QCTL_DNAT_APPLY: '/tmp/qctl-missing-dnat.sh' },
      log: (l) => logs.push(l),
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })
    expect(logs[0]).toMatch(/skipping DNAT/)
  })

  test('applyDnat runs script when present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qctl-dnat-'))
    const script = join(dir, 'dnat.sh')
    await writeFile(script, '#!/bin/bash\nexit 0\n')
    /** @type {string[][]} */
    const cmds = []
    await applyDnat({
      env: { QCTL_DNAT_APPLY: script },
      log: () => {},
      exec: async (argv) => {
        cmds.push(argv)
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    expect(cmds).toEqual([['bash', script]])
  })
})
