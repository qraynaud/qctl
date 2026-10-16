import { join } from 'node:path'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { isMissingCommandMessage, registerCommands } from './yargs.js'
import { describe, expect, test } from 'bun:test'

describe('registerCommands', () => {
  test('registers statically imported modules', async () => {
    /** @type {string[]} */
    const ran = []
    const ping = {
      command: 'ping',
      describe: 'ping command',
      handler() {
        ran.push('ping')
      },
    }
    const pong = {
      command: 'pong',
      describe: 'pong command',
      handler() {
        ran.push('pong')
      },
    }

    await registerCommands(yargs(hideBin(['node', 'cli', 'ping'])), [ping, pong])
      .scriptName('cli')
      .demandCommand(1)
      .parse()

    expect(ran).toEqual(['ping'])
  })

  test('hides internal commands from help unless withInternals', async () => {
    const pub = { command: 'pub', describe: 'public cmd', handler() {} }
    const hid = {
      command: 'hid',
      describe: 'internal cmd',
      internal: true,
      handler() {},
    }

    const hiddenHelp = await registerCommands(yargs([]), [pub, hid])
      .scriptName('cli')
      .help()
      .wrap(null)
      .getHelp()
    expect(hiddenHelp).toContain('pub')
    expect(hiddenHelp).toContain('public cmd')
    expect(hiddenHelp).not.toMatch(/\bhid\b/)

    const fullHelp = await registerCommands(yargs([]), [pub, hid], { withInternals: true })
      .scriptName('cli')
      .help()
      .wrap(null)
      .getHelp()
    expect(fullHelp).toContain('hid')
    expect(fullHelp).toContain('internal cmd')
  })
})

describe('exitZeroOnMissingCommand', () => {
  test('isMissingCommandMessage matches yargs demandCommand text', () => {
    expect(isMissingCommandMessage('Not enough non-option arguments: got 0, need at least 1')).toBe(
      true,
    )
    expect(isMissingCommandMessage('Unknown argument: foobar')).toBe(false)
  })

  test('missing subcommand exits 0', async () => {
    const yargsPath = join(import.meta.dir, 'yargs.js')
    const proc = Bun.spawn(
      [
        'bun',
        '-e',
        `
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { exitZeroOnMissingCommand, registerCommands } from ${JSON.stringify(yargsPath)}

const ping = { command: 'ping', describe: 'ping', handler() {} }
await exitZeroOnMissingCommand(
  registerCommands(yargs(hideBin(['node', 'cli'])), [ping])
    .scriptName('cli')
    .demandCommand(1)
    .strictCommands()
    .help(),
).parse()
`,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(code).toBe(0)
    expect(stdout).toContain('ping')
    expect(stderr).toBe('')
  })
})
