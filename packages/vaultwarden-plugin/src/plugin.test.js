const { afterAll, beforeAll, describe, expect, test } = require('bun:test')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  CoercionError,
  ResolutionError,
  SchemaError,
  ValidationError,
} = require('varlock/plugin-lib')

/**
 * @typedef {object} PluginRegistration
 * @property {string} name
 * @property {(args: {
 *   arrArgs?: string[],
 *   objArgs?: Record<string, never>,
 * }) => Promise<void | Record<string, never>>} [process]
 */

/**
 * @typedef {object} PluginStub
 * @property {{
 *   SchemaError: typeof SchemaError,
 *   ResolutionError: typeof ResolutionError,
 *   ValidationError: typeof ValidationError,
 *   CoercionError: typeof CoercionError,
 * }} ERRORS
 * @property {string} name
 * @property {string} icon
 * @property {PluginRegistration[]} rootDecorators
 * @property {PluginRegistration[]} resolverFunctions
 * @property {PluginRegistration[]} dataTypes
 * @property {(d: PluginRegistration) => void} registerRootDecorator
 * @property {(d: PluginRegistration) => void} registerResolverFunction
 * @property {(d: PluginRegistration) => void} registerDataType
 */

/** @type {PluginStub} */
const stub = {
  ERRORS: { SchemaError, ResolutionError, ValidationError, CoercionError },
  name: '',
  icon: '',
  rootDecorators: [],
  resolverFunctions: [],
  dataTypes: [],
  registerRootDecorator(d) {
    this.rootDecorators.push(d)
  },
  registerResolverFunction(d) {
    this.resolverFunctions.push(d)
  },
  registerDataType(d) {
    this.dataTypes.push(d)
  },
}

/** @type {() => void} */
let deactivatePlugin = () => {}

beforeAll(async () => {
  const pluginLibPath = require.resolve('varlock/plugin-lib')
  const pluginContextPath = path.join(path.dirname(pluginLibPath), 'plugin-context-DWgJArxE.mjs')
  const ctx = await import(pathToFileURL(pluginContextPath).href)
  const activatePlugin = /** @type {(p: PluginStub) => void} */ (ctx.t)
  deactivatePlugin = /** @type {() => void} */ (ctx.n)
  Object.defineProperty(stub, 'cache', {
    get() {
      throw new Error('no cache outside load')
    },
  })
  activatePlugin(stub)
  try {
    require('./plugin.js')
  } finally {
    deactivatePlugin()
  }
})

afterAll(() => {
  deactivatePlugin()
})

describe('vaultwarden plugin', () => {
  test('registers initVw, vwSession, and vw under qctl-vaultwarden', () => {
    expect(stub.name).toBe('qctl-vaultwarden')
    expect(stub.icon).toBe('mdi:shield-key')
    expect(stub.rootDecorators.map((d) => d.name)).toContain('initVw')
    expect(stub.dataTypes.map((d) => d.name)).toContain('vwSession')
    expect(stub.resolverFunctions.map((d) => d.name)).toContain('vw')
  })

  test('initVw process rejects positional args', async () => {
    const initVw = stub.rootDecorators.find((d) => d.name === 'initVw')
    if (!initVw?.process) throw new Error('expected initVw.process')
    const process = initVw.process
    await expect(
      process({
        arrArgs: ['positional'],
        objArgs: {},
      }),
    ).rejects.toThrow(/named arguments only/)
  })
})
