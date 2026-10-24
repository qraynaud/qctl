import { installPackages } from './install-packages.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  Bun.spawn.mockRestore?.()
})

/**
 * @param {(args: string[]) => number | undefined} [codeFor]
 */
function mockSpawn(codeFor) {
  /** @type {string[][]} */
  const calls = []
  spyOn(Bun, 'spawn').mockImplementation((argv) => {
    const args = /** @type {string[]} */ (argv)
    calls.push(args)
    const code = codeFor?.(args) ?? 0
    return /** @type {ReturnType<typeof Bun.spawn>} */ ({
      exited: Promise.resolve(code),
      stdout: new ReadableStream({
        start(c) {
          if (args[0] === 'rpm' && args[1] === '--eval') {
            c.enqueue(new TextEncoder().encode('.el9\n'))
          }
          c.close()
        },
      }),
      stderr: new ReadableStream({
        start(c) {
          c.close()
        },
      }),
    })
  })
  return calls
}

describe('installPackages', () => {
  test('no-ops on empty package list without upgrade', async () => {
    const spawn = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('should not spawn')
    })
    /** @type {string[]} */
    const logs = []
    await installPackages([], { log: (l) => logs.push(l) })
    expect(spawn).not.toHaveBeenCalled()
    expect(logs).toEqual([])
  })

  test('bootstraps EPEL then installs non-zfs packages via dnf', async () => {
    const calls = mockSpawn()
    /** @type {string[]} */
    const logs = []
    await installPackages(['curl', 'jq'], { log: (l) => logs.push(l) })
    expect(logs.some((l) => l.includes('epel-release'))).toBe(true)
    expect(
      calls.some(
        (c) => c[0] === 'dnf' && c.includes('epel-release') && c.includes('dnf-plugins-core'),
      ),
    ).toBe(true)
    expect(calls.some((c) => c[0] === 'dnf' && c.includes('curl') && c.includes('jq'))).toBe(true)
  })

  test('upgrade runs dnf upgrade --refresh when requested', async () => {
    const calls = mockSpawn()
    await installPackages(['curl'], { log: () => {}, upgrade: true })
    expect(
      calls.some((c) => c[0] === 'dnf' && c.includes('upgrade') && c.includes('--refresh')),
    ).toBe(true)
  })

  test('skips zfs install when zpool already present but still enables units', async () => {
    const calls = mockSpawn((args) => {
      if (args.join(' ').includes('command -v zpool')) return 0
      return 0
    })
    /** @type {string[]} */
    const logs = []
    await installPackages(['zfs'], { log: (l) => logs.push(l) })
    expect(logs.some((l) => l.includes('zfs already present'))).toBe(true)
    expect(calls.some((c) => c[0] === 'systemctl' && c[1] === 'enable')).toBe(true)
    expect(calls.some((c) => c[0] === 'modprobe' && c.includes('zfs'))).toBe(true)
  })

  test('cockpit triggers best-effort cockpit-zfs', async () => {
    const calls = mockSpawn((args) => {
      if (args[0] === 'rpm' && args[1] === '-q' && args[2] === 'cockpit-zfs') return 1
      return 0
    })
    /** @type {string[]} */
    const logs = []
    await installPackages(['cockpit'], { log: (l) => logs.push(l) })
    expect(logs.some((l) => l.includes('cockpit-zfs'))).toBe(true)
    expect(calls.some((c) => c.includes('cockpit-zfs'))).toBe(true)
  })
})
