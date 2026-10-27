import { podman, stripPodmanNoise } from './podman.js'
import { die } from './util.js'

/** @import { LocalContext } from './context.js' */

/**
 * Env passed into every `podman exec` for guest qctl.
 * Identity (root / env / apps) comes from `/etc/qctl/config.json` written by provision —
 * do not inject `QCTL_ROOT` / `QCTL_ENV` here. Path vars (`APP_ROOT`, …) come from
 * instance `.env.*` (no local overrides).
 * @param {LocalContext} ctx
 * @returns {Record<string, string>}
 */
export function applianceExecEnv(ctx) {
  return {
    QCTL_PLATFORM_MODULE: `/usr/local/lib/qctl/${ctx.platformBasename}`,
    QCTL_LIB_DIR: '/usr/local/lib/qctl',
    // Nested podman inside the appliance — keep its logs quiet too.
    CONTAINERS_LOG_LEVEL: 'fatal',
  }
}

/**
 * @param {LocalContext} ctx
 * @param {string} script bash -lc body
 * @param {{ nothrow?: boolean, inherit?: boolean }} [opts]
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
export async function execInAppliance(ctx, script, opts = {}) {
  const envArgs = Object.entries(applianceExecEnv(ctx)).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const args = ['exec', ...envArgs, ctx.name, 'bash', '-lc', script]

  if (opts.inherit) {
    const proc = Bun.spawn(['podman', '--log-level=fatal', ...args], {
      stdio: ['inherit', 'inherit', 'inherit'],
      env: process.env,
    })
    const exitCode = await proc.exited
    if (!opts.nothrow && exitCode !== 0) {
      die(`podman exec failed (exit ${exitCode})`)
    }
    return { exitCode, stdout: '', stderr: '' }
  }

  const r = await podman(args, { nothrow: true })
  if (!opts.nothrow && r.exitCode !== 0) {
    const err = stripPodmanNoise(String(r.stderr || r.stdout)).trim()
    die(err || `podman exec failed (exit ${r.exitCode})`)
  }
  return {
    exitCode: r.exitCode ?? 0,
    stdout: String(r.stdout),
    stderr: String(r.stderr),
  }
}

/**
 * Interactive TTY shell (or non-TTY bash -lc).
 * @param {LocalContext} ctx
 * @param {string[]} [cmd]
 * @returns {Promise<number>}
 */
export async function shellInAppliance(ctx, cmd) {
  const envArgs = Object.entries(applianceExecEnv(ctx)).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const args = ['exec', '-it', ...envArgs, ctx.name]
  if (cmd?.length) {
    args.push('bash', '-lc', cmd.join(' '))
  } else {
    args.push('bash', '-l')
  }
  const proc = Bun.spawn(['podman', '--log-level=fatal', ...args], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: process.env,
  })
  return await proc.exited
}
