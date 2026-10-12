import { installPackages } from './install-packages.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  Bun.spawn.mockRestore?.()
})

describe('installPackages', () => {
  test('no-ops on empty package list', async () => {
    const spawn = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('should not spawn')
    })
    /** @type {string[]} */
    const logs = []
    await installPackages([], { log: (l) => logs.push(l) })
    expect(spawn).not.toHaveBeenCalled()
    expect(logs).toEqual([])
  })

  test('installs non-zfs packages via dnf', async () => {
    /** @type {string[][]} */
    const calls = []
    spyOn(Bun, 'spawn').mockImplementation((argv) => {
      calls.push(/** @type {string[]} */ (argv))
      return /** @type {ReturnType<typeof Bun.spawn>} */ ({
        exited: Promise.resolve(0),
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
      })
    })
    /** @type {string[]} */
    const logs = []
    await installPackages(['curl', 'jq'], { log: (l) => logs.push(l) })
    expect(logs.some((l) => l.includes('dnf'))).toBe(true)
    expect(calls.some((c) => c[0] === 'dnf' && c.includes('curl'))).toBe(true)
  })

  test('skips zfs install when zpool already present', async () => {
    /** @type {string[][]} */
    const calls = []
    spyOn(Bun, 'spawn').mockImplementation((argv) => {
      const args = /** @type {string[]} */ (argv)
      calls.push(args)
      const cmd = args.join(' ')
      if (cmd.includes('command -v zpool')) {
        return /** @type {ReturnType<typeof Bun.spawn>} */ ({
          exited: Promise.resolve(0),
          stdout: new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('/usr/sbin/zpool\n'))
              c.close()
            },
          }),
          stderr: new ReadableStream({
            start(c) {
              c.close()
            },
          }),
        })
      }
      return /** @type {ReturnType<typeof Bun.spawn>} */ ({
        exited: Promise.resolve(0),
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
      })
    })
    /** @type {string[]} */
    const logs = []
    await installPackages(['zfs'], { log: (l) => logs.push(l) })
    expect(logs.some((l) => l.includes('zfs already present'))).toBe(true)
    expect(calls.every((c) => !(c[0] === 'dnf' && c.includes('zfs')))).toBe(true)
  })
})
