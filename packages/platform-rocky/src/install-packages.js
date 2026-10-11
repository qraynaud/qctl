/**
 * Install distro packages the Rocky way (dnf). ZoL special-case when `zfs` is listed.
 */

/** @import { PlatformInstallOpts } from '@qctl/shared' */

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ inherit?: boolean }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function run(argv, env, opts = {}) {
  const proc = Bun.spawn(argv, {
    env: /** @type {Record<string, string>} */ (env),
    stdout: opts.inherit ? 'inherit' : 'pipe',
    stderr: opts.inherit ? 'inherit' : 'pipe',
    stdin: 'inherit',
  })
  if (opts.inherit) {
    return { code: await proc.exited, stdout: '', stderr: '' }
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

/**
 * ZoL: release RPM + kmod repo, then `dnf install zfs` (idempotent).
 * @param {(line: string) => void} log
 * @param {Record<string, string | undefined>} env
 */
async function ensureZfs(log, env) {
  const have = await run(['bash', '-c', 'command -v zpool'], env)
  if (have.code === 0) {
    log('rocky-packages: zfs already present')
    return
  }
  log('rocky-packages: installing ZoL (zfs-release + zfs-kmod)')
  const dist = await run(['rpm', '--eval', '%{dist}'], env)
  const distTag = dist.stdout.trim() || '.el9'
  const urls = [
    `https://zfsonlinux.org/epel/zfs-release-3-0${distTag}.noarch.rpm`,
    `https://zfsonlinux.org/epel/zfs-release-2-3${distTag}.noarch.rpm`,
  ]
  let releaseOk = false
  for (const url of urls) {
    const r = await run(['dnf', 'install', '-y', url], env, { inherit: true })
    if (r.code === 0) {
      releaseOk = true
      break
    }
  }
  if (!releaseOk) throw new Error('failed to install zfs-release RPM')
  await run(['dnf', 'config-manager', '--disable', 'zfs'], env)
  await run(['dnf', 'config-manager', '--enable', 'zfs-kmod'], env)
  const z = await run(['dnf', 'install', '-y', 'zfs'], env, { inherit: true })
  if (z.code !== 0) throw new Error('dnf install zfs failed')
}

/**
 * @param {string[]} packages
 * @param {PlatformInstallOpts} [opts]
 */
export async function installPackages(packages, opts = {}) {
  const log = opts.log ?? ((line) => console.log(line))
  const env = { ...(opts.env ?? process.env) }

  const names = [...(packages || [])].map((p) => String(p).trim()).filter(Boolean)
  const wantZfs = names.includes('zfs')
  const rest = names.filter((p) => p !== 'zfs')

  if (wantZfs) await ensureZfs(log, env)

  if (rest.length > 0) {
    log(`rocky-packages: distro: installing ${rest.length} package(s) via dnf`)
    const r = await run(['dnf', 'install', '-y', ...rest], env, { inherit: true })
    if (r.code !== 0) throw new Error(`dnf install failed (exit ${r.code})`)
  }
}
