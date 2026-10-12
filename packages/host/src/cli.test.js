import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '../../shared/src/test-helpers.js'
import { initInstance } from './init.js'
import { getSeed, repoHash, resetRepoRootCache } from './lib/paths.js'
import { afterEach, describe, expect, test } from 'bun:test'

const ROOT = join(import.meta.dir, '../../..')
const origCwd = process.cwd()
const origCacheHome = process.env.QCTL_CACHE_HOME

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [opts]
 */
async function runHost(args, opts = {}) {
  const proc = Bun.spawn(['bun', 'run', join(ROOT, 'packages/host/src/cli.js'), ...args], {
    cwd: opts.cwd ?? ROOT,
    env: {
      ...process.env,
      ...opts.env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, code }
}

/** @type {string[]} */
const temps = []
afterEach(() => {
  process.chdir(origCwd)
  resetRepoRootCache()
  if (origCacheHome === undefined) delete process.env.QCTL_CACHE_HOME
  else process.env.QCTL_CACHE_HOME = origCacheHome
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

const VM_COMMANDS = [
  'seed',
  'download',
  'up',
  'down',
  'destroy',
  'init-tank',
  'status',
  'ssh-info',
  'target-check',
]

describe('host CLI', () => {
  test('--help lists init, new, sync, vm, seed-kit, local', async () => {
    const { stdout, code } = await runHost(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('init')
    expect(stdout).toContain('new')
    expect(stdout).toContain('sync')
    expect(stdout).toContain('vm')
    expect(stdout).toContain('seed-kit')
    expect(stdout).toContain('local')
  })

  test('local --help lists up/test/down/shell/ps/logs', async () => {
    const { stdout, code } = await runHost(['local', '--help'])
    expect(code).toBe(0)
    for (const name of ['up', 'test', 'down', 'shell', 'ps', 'logs']) {
      expect(stdout).toContain(`qctl local ${name}`)
    }
  })

  test('seed-kit path prints kit with user-data.yaml', async () => {
    const { stdout, code } = await runHost(['seed-kit', 'path'])
    expect(code).toBe(0)
    const root = stdout.trim()
    expect(await Bun.file(join(root, 'cloud-init', 'user-data.yaml')).exists()).toBe(true)
  })

  test('bare qctl / qctl vm show help and exit 0', async () => {
    const root = await runHost([])
    expect(root.code).toBe(0)
    expect(root.stderr + root.stdout).toContain('vm')

    const vm = await runHost(['vm'])
    expect(vm.code).toBe(0)
    expect(vm.stderr + vm.stdout).toContain('seed')
  })

  test('unknown command still exits 1', async () => {
    const { code } = await runHost(['definitely-not-a-command'])
    expect(code).toBe(1)
  })

  test('sync --help lists env/target and include-tooling', async () => {
    const { stdout, code } = await runHost(['sync', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('--env')
    expect(stdout).toContain('--target')
    expect(stdout).toContain('--include-tooling')
    expect(stdout).toContain('--remote-dir')
    expect(stdout).toContain('--delete')
    // passt lab ports belong on vm up / ssh-info, not sync
    expect(stdout).not.toContain('--cockpit-port')
    expect(stdout).not.toContain('--caddy-http-port')
  })

  test('init --help', async () => {
    const { stdout, code } = await runHost(['init', '--help'])
    expect(code).toBe(0)
    expect(stdout.toLowerCase()).toMatch(/scaffold|dir/)
  })

  test('vm --help lists the real vm commands', async () => {
    const { stdout, code } = await runHost(['vm', '--help'])
    expect(code).toBe(0)
    for (const name of VM_COMMANDS) expect(stdout).toContain(`qctl vm ${name}`)
    expect(stdout).not.toContain('not implemented yet')
  })

  test('vm seed --help lists real options', async () => {
    const { stdout, code } = await runHost(['vm', 'seed', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('--profile')
    expect(stdout).toContain('--allow-missing-tier0')
    expect(stdout).toContain('--instance-id')
    expect(stdout).toContain('provision/<env>.yaml')
  })

  test('vm up --help works outside an instance', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const { stdout, code } = await runHost(['vm', 'up', '--help'], { cwd: dir })
    expect(code).toBe(0)
    expect(stdout).toContain('--wipe-os')
  })

  test('vm init-tank --help has boot flags but not passt service ports', async () => {
    const { stdout, code } = await runHost(['vm', 'init-tank', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('--memory')
    expect(stdout).toContain('--timeout')
    expect(stdout).not.toContain('--ssh-port')
    expect(stdout).not.toContain('--cockpit-port')
    expect(stdout).not.toContain('--caddy-http-port')
  })

  test('vm up --help lists passt ports inside an instance', async () => {
    const root = makeTempDir()
    temps.push(root)
    const { root: dir } = initInstance(join(root, 'demo'))
    const { stdout, code } = await runHost(['vm', 'up', '--help'], { cwd: dir })
    expect(code).toBe(0)
    expect(stdout).toContain('--ssh-port')
  })

  test('vm seed outside an instance exits 1 with guidance', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const { stdout, stderr, code } = await runHost(['vm', 'seed'], { cwd: dir })
    expect(code).toBe(1)
    expect(`${stdout}${stderr}`).toMatch(/not inside a qctl instance/)
  })

  test('vm seed builds ISO (tmp stage) from provision/*.yaml + !env', async () => {
    const base = makeTempDir()
    temps.push(base)
    const root = realpathSync(initInstance(join(base, 'inst')).root)
    const seedKit = join(base, 'seed-kit')
    const keep = join(base, 'keep-cidata')
    mkdirSync(join(seedKit, 'cloud-init'), { recursive: true })
    writeFileSync(
      join(seedKit, 'cloud-init', 'user-data.yaml'),
      [
        "hostname: !template '{{ local_hostname }}'",
        "tank: !template '{{ secrets.guest.TANK_PASSPHRASE }}'",
        "ssh_keys: !template '{{ admin_ssh_authorized_keys }}'",
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(seedKit, 'cloud-init', 'meta-data.yaml'),
      "instance-id: !template '{{ instance_id }}'\nlocal-hostname: rocky\n",
    )

    const xdgCache = join(base, 'xdg-cache')
    const xdgData = join(base, 'xdg-data')
    const guestDist = join(base, 'guest-dist')
    mkdirSync(guestDist, { recursive: true })
    writeFileSync(join(guestDist, 'qctl-guest'), '#!/bin/sh\n')
    writeFileSync(join(guestDist, 'qctl-platform-rocky.mjs'), 'export default {}\n')
    writeFileSync(join(guestDist, 'varlock-local-encrypt'), '#!/bin/sh\n')
    const { stdout, stderr, code } = await runHost(['vm', 'seed', '--out', keep], {
      cwd: root,
      env: {
        QCTL_ROCKY_SEED: seedKit,
        QCTL_GUEST_DIST: guestDist,
        QCTL_CACHE_HOME: xdgCache,
        QCTL_DATA_HOME: xdgData,
        TANK_PASSPHRASE: 'lab-tank-passphrase',
        HOME: (() => {
          const h = join(base, 'home')
          mkdirSync(join(h, '.ssh'), { recursive: true })
          writeFileSync(join(h, '.ssh', 'id_ed25519.pub'), 'ssh-ed25519 AAAATEST test@example\n')
          return h
        })(),
      },
    })
    expect(`${stdout}${stderr}`).toContain('vm seed: wrote')
    expect(code).toBe(0)

    // Resolve seed path the same way as the CLI (cwd = instance root).
    process.chdir(root)
    process.env.QCTL_CACHE_HOME = xdgCache
    const seedEnv = join(getSeed(), 'dev')
    expect(seedEnv).toContain(join('repos', repoHash(root), 'seed', 'dev'))
    expect(existsSync(join(root, 'provision', 'local', 'seed'))).toBe(false)
    expect(existsSync(join(seedEnv, 'cidata'))).toBe(false)
    expect(existsSync(join(seedEnv, 'instance-id'))).toBe(true)
    expect(readFileSync(join(seedEnv, 'instance-id'), 'utf8')).toContain('rocky-dev')
    expect(existsSync(join(seedEnv, 'nocloud.iso'))).toBe(true)
    expect(existsSync(join(seedEnv, 'cidata.img'))).toBe(false)

    const userData = readFileSync(join(keep, 'user-data'), 'utf8')
    expect(userData.startsWith('#cloud-config')).toBe(true)
    expect(userData).toContain('lab-tank-passphrase')
    expect(userData).toContain('AAAATEST')
    expect(existsSync(join(keep, 'qctl-guest', 'bootstrap'))).toBe(false)
    expect(existsSync(join(keep, 'qctl-guest', 'qctl-guest'))).toBe(true)
    expect(existsSync(join(keep, 'qctl-guest', 'qctl-platform-rocky.mjs'))).toBe(true)
    expect(readFileSync(join(keep, 'meta-data'), 'utf8')).toContain('rocky-dev')
    expect(existsSync(join(keep, 'network-config'))).toBe(true)
  })

  test('new app --help', async () => {
    const { stdout, code } = await runHost(['new', 'app', '--help'])
    expect(code).toBe(0)
    expect(stdout.toLowerCase()).toContain('app')
  })
})
