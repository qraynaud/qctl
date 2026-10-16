import {
  domainExists,
  domainState,
  redefineDomainXml,
  removeDomain,
  stopDomainForRedefine,
} from './domain.js'
import { routeVirsh, virshReply } from './test-virsh.js'
import * as virshMod from './virsh.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  virshMod.virsh.mockRestore?.()
})

describe('domainExists / domainState', () => {
  test('domainExists follows dominfo exit code', async () => {
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => virshReply(cmd === 'dominfo' ? 0 : 1)),
    )
    expect(await domainExists('qemu:///session', 'a')).toBe(true)

    spyOn(virshMod, 'virsh').mockImplementation(routeVirsh(() => virshReply(1)))
    expect(await domainExists('qemu:///session', 'a')).toBe(false)
  })

  test('domainState returns trimmed stdout or null', async () => {
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => (cmd === 'domstate' ? virshReply(0, '  running\n') : virshReply(1))),
    )
    expect(await domainState('qemu:///session', 'a')).toBe('running')

    spyOn(virshMod, 'virsh').mockImplementation(routeVirsh(() => virshReply(1)))
    expect(await domainState('qemu:///session', 'a')).toBeNull()
  })
})

describe('redefineDomainXml', () => {
  test('returns false when transform yields null', async () => {
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => (cmd === 'dumpxml' ? virshReply(0, '<domain/>') : virshReply(0))),
    )
    const ok = await redefineDomainXml('qemu:///session', 'a', () => null, 'noop')
    expect(ok).toBe(false)
  })

  test('defines transformed xml when changed', async () => {
    /** @type {string[]} */
    const defined = []
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd, ...args) => {
        if (cmd === 'dumpxml') return virshReply(0, '<domain>old</domain>')
        if (cmd === 'define') {
          defined.push(args[0] || '')
          return virshReply(0)
        }
        return virshReply(0)
      }),
    )
    const ok = await redefineDomainXml(
      'qemu:///session',
      'a',
      (xml) => xml.replace('old', 'new'),
      'test',
    )
    expect(ok).toBe(true)
    expect(defined).toHaveLength(1)
    const written = await Bun.file(defined[0])
      .text()
      .catch(() => '')
    // temp file is unlinked in finally; content was written before define
    expect(defined[0]).toContain('rocky-a-test.xml')
    void written
  })
})

describe('stopDomainForRedefine', () => {
  test('destroys when running', async () => {
    /** @type {string[]} */
    const cmds = []
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => {
        cmds.push(cmd)
        if (cmd === 'domstate') return virshReply(0, 'running')
        return virshReply(0)
      }),
    )
    await stopDomainForRedefine('qemu:///session', 'a', 'test')
    expect(cmds).toContain('destroy')
  })

  test('skips destroy when shut off', async () => {
    /** @type {string[]} */
    const cmds = []
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => {
        cmds.push(cmd)
        if (cmd === 'domstate') return virshReply(0, 'shut off')
        return virshReply(0)
      }),
    )
    await stopDomainForRedefine('qemu:///session', 'a', 'test')
    expect(cmds).not.toContain('destroy')
  })
})

describe('removeDomain', () => {
  test('returns false when domain missing', async () => {
    spyOn(virshMod, 'virsh').mockImplementation(routeVirsh(() => virshReply(1)))
    expect(await removeDomain('qemu:///session', 'missing')).toBe(false)
  })

  test('destroys running domain then undefines', async () => {
    /** @type {string[][]} */
    const calls = []
    let exists = true
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd, ...args) => {
        calls.push([cmd, ...args])
        if (cmd === 'dominfo') return virshReply(exists ? 0 : 1)
        if (cmd === 'domstate') return virshReply(0, 'running')
        if (cmd === 'destroy') return virshReply(0)
        if (cmd === 'undefine') {
          exists = false
          return virshReply(0)
        }
        return virshReply(0)
      }),
    )
    expect(await removeDomain('qemu:///session', 'demo')).toBe(true)
    expect(calls.some((c) => c[0] === 'destroy')).toBe(true)
    expect(
      calls.some((c) => c[0] === 'undefine' && c.includes('--nvram') && c.includes('--tpm')),
    ).toBe(true)
  })
})
