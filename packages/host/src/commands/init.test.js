import * as initMod from '../init.js'
import * as mod from './init.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  initMod.initInstance.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
})

describe('init command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('init [dir]')
    expect(mod.describe).toContain('Scaffold')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('handler logs written files from initInstance', async () => {
    spyOn(initMod, 'initInstance').mockReturnValue({
      root: '/tmp/demo',
      written: ['mise.toml'],
      skipped: ['provision/dev.yaml'],
    })
    /** @type {string[]} */
    const lines = []
    spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })
    await mod.handler({ dir: '/tmp/demo', force: true })
    expect(initMod.initInstance).toHaveBeenCalledWith('/tmp/demo', { force: true })
    expect(lines.some((l) => l.includes('initialized'))).toBe(true)
    expect(lines.some((l) => l.includes('+ mise.toml'))).toBe(true)
  })

  test('handler sets exitCode on error', async () => {
    spyOn(initMod, 'initInstance').mockImplementation(() => {
      throw new Error('already exists')
    })
    spyOn(console, 'error').mockImplementation(() => {})
    await mod.handler({ dir: '.' })
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
