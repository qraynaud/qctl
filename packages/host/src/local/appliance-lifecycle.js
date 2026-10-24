/**
 * Nested systemd appliance container: create / start / stop / wait.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { podman, stripPodmanNoise } from './podman.js'
import { provisionAppliance } from './provision.js'
import { die, log, logDim } from './util.js'

/** @import { LocalContext } from './context.js' */

/**
 * Host registries auth for nested rootful pulls (e.g. docker.io after `podman login`).
 * @returns {string | null}
 */
export function hostContainersAuthFile() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  /** @type {string[]} */
  const candidates = []
  if (uid != null) candidates.push(join('/run/user', String(uid), 'containers/auth.json'))
  candidates.push(join(homedir(), '.config/containers/auth.json'))
  return candidates.find((p) => existsSync(p)) || null
}

/**
 * @param {LocalContext} ctx
 * @returns {Promise<boolean>}
 */
export async function applianceExists(ctx) {
  const r = await podman(['container', 'exists', ctx.name], { nothrow: true })
  return r.exitCode === 0
}

/**
 * @param {LocalContext} ctx
 * @returns {Promise<boolean>}
 */
export async function applianceRunning(ctx) {
  if (!(await applianceExists(ctx))) return false
  const r = await podman(['inspect', '-f', '{{.State.Running}}', ctx.name], { nothrow: true })
  return String(r.stdout).trim() === 'true'
}

/**
 * @param {LocalContext} ctx
 * @returns {Promise<void>}
 */
export async function removeAppliance(ctx) {
  log(`remove ${ctx.name}`)
  await podman(['rm', '-f', ctx.name], { nothrow: true })
}

/**
 * Wait until systemd is running|degraded inside the appliance.
 * @param {LocalContext} ctx
 * @param {number} [seconds]
 * @returns {Promise<void>}
 */
export async function waitSystemd(ctx, seconds = 90) {
  logDim('waiting for systemd…')
  for (let i = 0; i < seconds; i++) {
    if (!(await applianceRunning(ctx))) {
      die('appliance container exited while waiting for systemd')
    }
    const r = await podman(['exec', ctx.name, 'systemctl', 'is-system-running'], { nothrow: true })
    const state = String(r.stdout).trim()
    if (state === 'running' || state === 'degraded') {
      logDim(`systemd ${state}`)
      return
    }
    if (i > 0 && i % 10 === 0) logDim(`still waiting for systemd (${state || '…'}, ${i}s)`)
    await Bun.sleep(1000)
  }
  const logs = await podman(['logs', '--tail', '80', ctx.name], { nothrow: true })
  console.error(stripPodmanNoise(String(logs.stdout || logs.stderr)))
  die('systemd appliance not ready')
}

/**
 * Start (or reuse) the nested appliance and provision once when newly created.
 * @param {LocalContext} ctx
 * @returns {Promise<void>}
 */
export async function ensureAppliance(ctx) {
  if (await applianceRunning(ctx)) {
    logDim(`appliance already running (${ctx.name})`)
    return
  }

  if (await applianceExists(ctx)) {
    log(`start existing ${ctx.name}`)
    const r = await podman(['start', ctx.name], { nothrow: true })
    if (r.exitCode !== 0) {
      die(String(r.stderr || r.stdout).trim() || 'podman start failed')
    }
    await waitSystemd(ctx)
    return
  }

  mkdirSync(join(ctx.root, 'volumes'), { recursive: true })

  log(`boot systemd appliance (${ctx.image})`)
  const runArgs = [
    'run',
    '-d',
    '--name',
    ctx.name,
    '--privileged',
    '--systemd=always',
    '--cgroupns=host',
    ...ctx.uidMapArgs,
    ...ctx.publishArgs,
    '-v',
    `${ctx.root}:/tank/rocky:Z`,
    '-v',
    `${ctx.guestBin}:/usr/local/bin/qctl:ro`,
    '-v',
    `${ctx.platformModulePath}:/usr/local/lib/qctl/${ctx.platformBasename}:ro`,
    '-e',
    'container=podman',
    '-e',
    `QCTL_PLATFORM_MODULE=/usr/local/lib/qctl/${ctx.platformBasename}`,
    '-e',
    'QCTL_LIB_DIR=/usr/local/lib/qctl',
    '-e',
    'APP_ROOT=/tank/rocky/volumes',
    '-e',
    'CONTAINERS_LOG_LEVEL=fatal',
    ctx.image,
    '/sbin/init',
  ]

  const authFile = hostContainersAuthFile()
  if (authFile) {
    // Nested rootful podman + REGISTRY_AUTH_FILE so docker.io login on the host applies.
    runArgs.splice(
      runArgs.length - 2,
      0,
      '-v',
      `${authFile}:/run/containers/auth.json:ro`,
      '-v',
      `${authFile}:/root/.config/containers/auth.json:ro`,
      '-e',
      'REGISTRY_AUTH_FILE=/run/containers/auth.json',
    )
  }

  const extra = process.env.QCTL_LOCAL_PODMAN_RUN_ARGS?.trim()
  if (extra) {
    // Same escape hatch as rocky CI (e.g. rare pasta workarounds).
    runArgs.splice(runArgs.length - 2, 0, ...extra.split(/\s+/).filter(Boolean))
  }

  const r = await podman(runArgs, { nothrow: true })
  if (r.exitCode !== 0) {
    die(String(r.stderr || r.stdout).trim() || 'podman run failed')
  }

  await waitSystemd(ctx)
  await provisionAppliance(ctx)
}
