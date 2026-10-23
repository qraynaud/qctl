import * as clack from '@clack/prompts'
import yargs from 'yargs'

import * as quickstart from '../init/quickstart.js'
import * as app from './new/app.js'
import * as mod from './new.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  process.exitCode = 0
})

describe('new command', () => {
  test('exports yargs metadata', () => {
    expect(mod.command).toBe('new')
    expect(mod.describe).toContain('Scaffold')
    expect(typeof mod.builder).toBe('function')
    expect(typeof mod.handler).toBe('function')
  })

  test('builder registers app/common/network/env/profile without demanding a subcommand', async () => {
    const help = await mod.builder(yargs().scriptName('qctl')).getHelp()
    for (const name of ['app', 'common', 'network', 'env', 'profile', 'unit']) {
      expect(help).toMatch(new RegExp(`\\b${name}\\b`))
    }
    expect(help).toMatch(/Proxmox|profile|picker/i)
  })

  test('promptNewKind returns the selected kind', async () => {
    const kind = await mod.promptNewKind({
      prompts: {
        intro() {},
        isCancel: () => false,
        async select() {
          return 'profile'
        },
      },
    })
    expect(kind).toBe('profile')
  })

  test('runNewKind dispatches to app handler', async () => {
    const spy = spyOn(app, 'handler').mockResolvedValue(undefined)
    await mod.runNewKind('app')
    expect(spy).toHaveBeenCalledWith({})
  })

  test('bare handler on non-TTY fails with kind hint', async () => {
    spyOn(quickstart, 'isInteractiveTty').mockReturnValue(false)
    /** @type {string[]} */
    const errs = []
    spyOn(console, 'error').mockImplementation((line) => {
      errs.push(String(line))
    })
    await mod.handler()
    expect(process.exitCode).toBe(1)
    expect(errs.some((l) => /profile\|env\|app/i.test(l))).toBe(true)
  })

  test('bare handler on TTY picks kind then dispatches', async () => {
    spyOn(quickstart, 'isInteractiveTty').mockReturnValue(true)
    spyOn(clack, 'intro').mockImplementation(() => {})
    spyOn(clack, 'select').mockResolvedValue(/** @type {never} */ ('app'))
    spyOn(clack, 'isCancel').mockReturnValue(false)
    const spy = spyOn(app, 'handler').mockResolvedValue(undefined)
    await mod.handler()
    expect(spy).toHaveBeenCalledWith({})
    expect(process.exitCode ?? 0).toBe(0)
  })
})
