import { argvApps } from './cli.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet cli helpers', () => {
  test('argvApps normalizes apps / app / empty', () => {
    expect(argvApps({})).toEqual([])
    expect(argvApps({ app: 'web' })).toEqual(['web'])
    expect(argvApps({ apps: 'proxy' })).toEqual(['proxy'])
    expect(argvApps({ apps: ['web', 'proxy'] })).toEqual(['web', 'proxy'])
    expect(argvApps({ apps: ['', 'web'] })).toEqual(['web'])
    expect(argvApps({ app: '' })).toEqual([])
  })
})
