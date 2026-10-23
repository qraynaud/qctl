import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import yargs from 'yargs'

import { resolveProfileArgv, sharedProfile } from './profile-argv.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../vm/types.js' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  for (const d of temps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

/**
 * @returns {string}
 */
function instanceWithBuiltins() {
  const root = mkdtempSync(join(tmpdir(), 'qctl-profile-argv-'))
  temps.push(root)
  mkdirSync(join(root, 'provision'), { recursive: true })
  writeFileSync(join(root, 'provision', 'common.yaml'), 'qctl:\n  platform: rocky\n')
  return root
}

describe('sharedProfile', () => {
  test('registers --profile / -p', async () => {
    const help = await sharedProfile(yargs().scriptName('qctl')).getHelp()
    expect(help).toMatch(/--profile/)
    expect(help).toMatch(/-p,/)
  })
})

describe('resolveProfileArgv', () => {
  test('fills env/target/production from built-in default profile', () => {
    const root = instanceWithBuiltins()
    /** @type {Partial<VmArgv>} */
    const argv = {}
    resolveProfileArgv(argv, { root })
    expect(argv).toMatchObject({
      profile: 'default',
      env: 'dev',
      target: 'workstation',
      production: false,
      _qctlProfileResolved: true,
    })
    expect(process.env.QCTL_ENV).toBe('dev')
  })

  test('is idempotent once resolved', () => {
    const root = instanceWithBuiltins()
    /** @type {Partial<VmArgv>} */
    const argv = {
      profile: 'default',
      env: 'dev',
      target: 'workstation',
      production: false,
      _qctlProfileResolved: true,
    }
    resolveProfileArgv(argv, { root })
    expect(argv.env).toBe('dev')
  })

  test('-p / --profile selects named profile (env+target+production)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qctl-profile-p-'))
    temps.push(root)
    mkdirSync(join(root, 'provision'), { recursive: true })
    writeFileSync(
      join(root, 'provision', 'common.yaml'),
      [
        'qctl:',
        '  environments:',
        '    lab: {}',
        '    prod: { production: true }',
        '  profiles:',
        '    lab: { env: lab, target: workstation }',
        '    prod: { env: prod, target: proxmox }',
        '  default-profile: lab',
      ].join('\n'),
    )
    const parsed = await sharedProfile(yargs().scriptName('qctl').exitProcess(false)).parseAsync([
      '-p',
      'prod',
    ])
    /** @type {Partial<VmArgv>} */
    const argv = { profile: /** @type {string} */ (parsed.profile) }
    resolveProfileArgv(argv, { root })
    expect(argv).toMatchObject({
      profile: 'prod',
      env: 'prod',
      target: 'proxmox',
      production: true,
    })
    expect(process.env.QCTL_ENV).toBe('prod')
  })

  test('multi-profile without default dies when --profile omitted', () => {
    const root = mkdtempSync(join(tmpdir(), 'qctl-profile-multi-'))
    temps.push(root)
    mkdirSync(join(root, 'provision'), { recursive: true })
    writeFileSync(
      join(root, 'provision', 'common.yaml'),
      [
        'qctl:',
        '  environments:',
        '    dev: {}',
        '    prod: { production: true }',
        '  profiles:',
        '    lab: { env: dev, target: workstation }',
        '    prod: { env: prod, target: proxmox }',
      ].join('\n'),
    )
    spyOn(console, 'error').mockImplementation(() => {})
    const exit = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`)
    })
    expect(() => resolveProfileArgv({}, { root })).toThrow(/exit 1/)
    exit.mockRestore()
  })

  test('requireWorkstation accepts workstation profiles and rejects proxmox', () => {
    const root = mkdtempSync(join(tmpdir(), 'qctl-profile-local-'))
    temps.push(root)
    mkdirSync(join(root, 'provision'), { recursive: true })
    writeFileSync(
      join(root, 'provision', 'common.yaml'),
      [
        'qctl:',
        '  environments:',
        '    lab: {}',
        '    prod: { production: true }',
        '  profiles:',
        '    lab: { env: lab, target: workstation }',
        '    prod: { env: prod, target: proxmox }',
        '  default-profile: lab',
      ].join('\n'),
    )
    /** @type {Partial<VmArgv>} */
    const ok = { profile: 'lab' }
    resolveProfileArgv(ok, { root, requireWorkstation: true })
    expect(ok.target).toBe('workstation')

    spyOn(console, 'error').mockImplementation(() => {})
    const exit = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`)
    })
    expect(() =>
      resolveProfileArgv({ profile: 'prod' }, { root, requireWorkstation: true }),
    ).toThrow(/exit 1/)
    exit.mockRestore()
  })
})
