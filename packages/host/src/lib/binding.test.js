import {
  asBindingPrompts,
  assertSecretName,
  ensureEnvValue,
  ensureSchemaSecret,
  formatEnvTag,
  formatYamlValue,
  parseBindingFlag,
  promptCredentialBinding,
} from './binding.js'
import { describe, expect, test } from 'bun:test'

/** @import { PromptCancelable, TextPromptOpts } from './binding.js' */

describe('assertSecretName / parseBindingFlag', () => {
  test('accepts UPPER_SNAKE_CASE', () => {
    expect(assertSecretName('TANK_PASSPHRASE')).toBe('TANK_PASSPHRASE')
    expect(assertSecretName('A')).toBe('A')
    expect(() => assertSecretName('tank_pass')).toThrow(/UPPER_SNAKE/)
    expect(() => assertSecretName('1BAD')).toThrow(/UPPER_SNAKE/)
  })

  test('parses static / secret / omit flags', () => {
    expect(parseBindingFlag('omit')).toEqual({ kind: 'omit' })
    expect(parseBindingFlag('static:lab-pass')).toEqual({
      kind: 'static',
      value: 'lab-pass',
    })
    expect(parseBindingFlag('static:a:b:c')).toEqual({ kind: 'static', value: 'a:b:c' })
    expect(parseBindingFlag('secret:TANK_PASSPHRASE')).toEqual({
      kind: 'secret',
      name: 'TANK_PASSPHRASE',
      encoding: 'utf8',
    })
    expect(parseBindingFlag('secret:DEPLOY_KEY:base64')).toEqual({
      kind: 'secret',
      name: 'DEPLOY_KEY',
      encoding: 'base64',
    })
    expect(() => parseBindingFlag('secret:badName')).toThrow(/UPPER_SNAKE/)
    expect(() => parseBindingFlag('nope')).toThrow(/invalid binding/)
  })
})

describe('formatEnvTag / formatYamlValue', () => {
  test('formats !env tags', () => {
    expect(formatEnvTag({ kind: 'secret', name: 'FOO', encoding: 'utf8' })).toBe('!env FOO')
    expect(formatEnvTag({ kind: 'secret', name: 'FOO', encoding: 'base64' })).toBe(
      '!env { name: FOO, encoding: base64 }',
    )
    expect(formatYamlValue({ kind: 'static', value: 'x' })).toBe('x')
    expect(formatYamlValue({ kind: 'secret', name: 'FOO', encoding: 'utf8' })).toBe('!env FOO')
  })
})

describe('ensureSchemaSecret / ensureEnvValue', () => {
  test('add-only schema keys with optional decorators', () => {
    const empty = '# ---\n'
    const a = ensureSchemaSecret(empty, 'TANK_PASSPHRASE')
    expect(a.changed).toBe(true)
    expect(a.text).toContain('TANK_PASSPHRASE=')
    const again = ensureSchemaSecret(a.text, 'TANK_PASSPHRASE')
    expect(again.changed).toBe(false)

    const opt = ensureSchemaSecret('# ---\n', 'SSH_HOST_KEYS', {
      optional: true,
      isPublic: false,
    })
    expect(opt.text).toContain('# @optional')
    expect(opt.text).toContain('SSH_HOST_KEYS=')
  })

  test('ensures env file values', () => {
    const r = ensureEnvValue('A=1\n', 'TANK_PASSPHRASE', 'lab')
    expect(r.text).toBe('A=1\nTANK_PASSPHRASE=lab\n')
    const u = ensureEnvValue(r.text, 'TANK_PASSPHRASE', 'other')
    expect(u.text).toBe('A=1\nTANK_PASSPHRASE=other\n')
  })
})

describe('promptCredentialBinding', () => {
  test('static path via injected prompts', async () => {
    const binding = await promptCredentialBinding({
      message: 'Tank passphrase',
      allowOmit: true,
      prompts: asBindingPrompts(
        /** @type {never} */ ({
          select: async () => 'static',
          text: async () => 'lab',
          confirm: async () => true,
          isCancel: (/** @type {PromptCancelable} */ v) => v === Symbol.for('cancel'),
          cancel: () => {},
        }),
      ),
    })
    expect(binding).toEqual({ kind: 'static', value: 'lab' })
  })

  test('secret + encoding + value now', async () => {
    /** @type {string[]} */
    const selects = ['secret', 'base64']
    const binding = await promptCredentialBinding({
      message: 'Deploy key',
      askEncoding: true,
      askValueNow: true,
      prompts: asBindingPrompts(
        /** @type {never} */ ({
          select: async () => selects.shift() ?? 'secret',
          text: async (/** @type {TextPromptOpts} */ q) => {
            if (String(q.message).includes('UPPER_SNAKE')) return 'DEPLOY_KEY'
            return 'c2VjcmV0'
          },
          confirm: async () => true,
          isCancel: () => false,
          cancel: () => {},
        }),
      ),
    })
    expect(binding).toEqual({
      kind: 'secret',
      name: 'DEPLOY_KEY',
      encoding: 'base64',
      value: 'c2VjcmV0',
    })
  })
})
