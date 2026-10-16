import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from '../../../init.js'
import { clearEnvProvisionCache } from '../../../lib/load-config.js'
import { resetRepoRootCache } from '../../../lib/paths.js'
import { buildVars } from './vars.js'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const origCwd = process.cwd()
const origCache = process.env.QCTL_CACHE_HOME
const origData = process.env.QCTL_DATA_HOME
const origHome = process.env.HOME
/** @type {string[]} */
const temps = []

beforeEach(() => {
  clearEnvProvisionCache()
  const base = makeTempDir()
  temps.push(base)
  process.env.QCTL_CACHE_HOME = join(base, 'cache')
  process.env.QCTL_DATA_HOME = join(base, 'data')
})

afterEach(() => {
  process.chdir(origCwd)
  resetRepoRootCache()
  clearEnvProvisionCache()
  if (origCache === undefined) delete process.env.QCTL_CACHE_HOME
  else process.env.QCTL_CACHE_HOME = origCache
  if (origData === undefined) delete process.env.QCTL_DATA_HOME
  else process.env.QCTL_DATA_HOME = origData
  if (origHome === undefined) delete process.env.HOME
  else process.env.HOME = origHome
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('buildVars', () => {
  test('builds seed context with profile and guest keys', async () => {
    const base = makeTempDir()
    temps.push(base)
    const home = join(base, 'home')
    mkdirSync(join(home, '.ssh'), { recursive: true })
    writeFileSync(join(home, '.ssh', 'id_ed25519.pub'), 'ssh-ed25519 AAAA test@host\n')
    process.env.HOME = home

    const root = realpathSync(initInstance(join(base, 'inst')).root)
    process.chdir(root)

    const ctx = await buildVars({
      instanceId: 'rocky-dev',
      env: 'dev',
      target: 'local',
      profile: 'appliance',
      allowMissingTier0: true,
    })
    expect(ctx.instance_id).toBe('rocky-dev')
    expect(ctx.profile).toBe('appliance')
    expect(ctx.is_init_tank).toBe(false)
    expect(ctx.local_hostname).toBe('rocky')
    expect(ctx.admin_ssh_authorized_keys?.length).toBeGreaterThan(0)
    expect(ctx.provision).toBeTruthy()
  })
})
