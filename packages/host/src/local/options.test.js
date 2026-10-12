import yargs from 'yargs'

import { sharedLocalEnv } from './options.js'
import { describe, expect, test } from 'bun:test'

describe('sharedLocalEnv', () => {
  test('registers --env with dev/prod choices', async () => {
    const help = await sharedLocalEnv(yargs().scriptName('qctl')).getHelp()
    expect(help).toMatch(/--env/)
    expect(help).toMatch(/dev/)
    expect(help).toMatch(/prod/)
  })
})
