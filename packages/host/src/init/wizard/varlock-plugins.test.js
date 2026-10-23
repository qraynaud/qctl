import {
  CUSTOM_VARLOCK_PLUGIN,
  VAULTWARDEN_PLUGIN,
  VAULTWARDEN_PLUGIN_RANGE,
  promptVarlockPlugins,
  validateNpmPackageName,
  varlockPluginHintBlock,
  varlockPluginsToDependencies,
} from './varlock-plugins.js'
import { describe, expect, test } from 'bun:test'

/** @import { BindingPrompts } from '../../lib/binding.js' */

describe('validateNpmPackageName', () => {
  test('accepts scoped and unscoped names', () => {
    expect(validateNpmPackageName('@qctl/vaultwarden-plugin')).toBeUndefined()
    expect(validateNpmPackageName('my-plugin')).toBeUndefined()
    expect(validateNpmPackageName('')).toBeTruthy()
    expect(validateNpmPackageName(CUSTOM_VARLOCK_PLUGIN)).toBeTruthy()
  })
})

describe('varlockPluginsToDependencies / hints', () => {
  test('maps deps and VW hint', () => {
    expect(
      varlockPluginsToDependencies([
        { package: VAULTWARDEN_PLUGIN, range: VAULTWARDEN_PLUGIN_RANGE },
        { package: '@varlock/1password-plugin', range: '*' },
      ]),
    ).toEqual({
      [VAULTWARDEN_PLUGIN]: VAULTWARDEN_PLUGIN_RANGE,
      '@varlock/1password-plugin': '*',
    })
    const hint = varlockPluginHintBlock([
      { package: VAULTWARDEN_PLUGIN, range: VAULTWARDEN_PLUGIN_RANGE },
    ])
    expect(hint).toContain(`@plugin(${VAULTWARDEN_PLUGIN})`)
    expect(hint).toContain('@initVw')
  })
})

describe('promptVarlockPlugins', () => {
  test('No on confirm returns empty without multiselect', async () => {
    let multiCalls = 0
    const plugins = await promptVarlockPlugins({
      prompts: /** @type {BindingPrompts} */ ({
        confirm: async () => false,
        multiselect: async () => {
          multiCalls += 1
          return []
        },
        text: async () => '',
        select: async () => '',
        isCancel: () => false,
      }),
    })
    expect(plugins).toEqual([])
    expect(multiCalls).toBe(0)
  })

  test('Yes then multiselect popular + skip custom', async () => {
    const plugins = await promptVarlockPlugins({
      prompts: /** @type {BindingPrompts} */ ({
        confirm: async () => true,
        multiselect: async () => [VAULTWARDEN_PLUGIN, '@varlock/1password-plugin'],
        text: async () => '',
        select: async () => '',
        isCancel: () => false,
      }),
    })
    expect(plugins).toEqual([
      { package: VAULTWARDEN_PLUGIN, range: VAULTWARDEN_PLUGIN_RANGE },
      { package: '@varlock/1password-plugin', range: '*' },
    ])
  })

  test('Yes + custom path', async () => {
    /** @type {string[]} */
    const texts = ['@acme/secrets-plugin', '^1.0.0']
    /** @type {boolean[]} */
    const confirms = [true, false] // need plugins; no another custom
    const plugins = await promptVarlockPlugins({
      prompts: /** @type {BindingPrompts} */ ({
        confirm: async () => confirms.shift(),
        multiselect: async () => [CUSTOM_VARLOCK_PLUGIN],
        text: async () => texts.shift(),
        select: async () => '',
        isCancel: () => false,
      }),
    })
    expect(plugins).toEqual([{ package: '@acme/secrets-plugin', range: '^1.0.0' }])
  })
})
