/**
 * Install distro packages the Rocky way (dnf). Absorbs former cloud-init runcmd:
 * EPEL bootstrap, ZoL, optional upgrade, ZFS units, best-effort cockpit-zfs.
 */

/** @import { PlatformInstallOpts } from '@qctl/shared' */

const ZFS_UNITS = [
  'zfs-import-cache.service',
  'zfs-import-scan.service',
  'zfs-mount.service',
  'zfs-zed.service',
]

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
 * EPEL + dnf-plugins-core (needed for ZoL `dnf config-manager`).
 * @param {(line: string) => void} log
 * @param {Record<string, string | undefined>} env
 */
async function ensureDnfBootstrap(log, env) {
  log('rocky-packages: ensuring epel-release + dnf-plugins-core')
  const r = await run(['dnf', 'install', '-y', 'epel-release', 'dnf-plugins-core'], env, {
    inherit: true,
  })
  if (r.code !== 0) throw new Error('dnf install epel-release / dnf-plugins-core failed')
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
  const distTag = dist.stdout.trim() || '.el10'
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
 * Enable ZoL import/mount/zed units + load the module (former cloud-init runcmd).
 * @param {(line: string) => void} log
 * @param {Record<string, string | undefined>} env
 */
async function enableZfsUnits(log, env) {
  log(`rocky-packages: enabling ${ZFS_UNITS.join(' ')}`)
  const en = await run(['systemctl', 'enable', ...ZFS_UNITS], env)
  if (en.code !== 0) {
    throw new Error(`systemctl enable zfs units failed: ${en.stderr.trim() || en.stdout.trim()}`)
  }
  await run(['modprobe', 'zfs'], env)
}

/**
 * Best-effort cockpit-zfs from 45Drives (ABI mismatches are non-fatal).
 * @param {(line: string) => void} log
 * @param {Record<string, string | undefined>} env
 */
async function ensureCockpitZfs(log, env) {
  const have = await run(['rpm', '-q', 'cockpit-zfs'], env)
  if (have.code === 0) {
    log('rocky-packages: cockpit-zfs already installed')
    return
  }
  log('rocky-packages: installing cockpit-zfs (45Drives; best-effort)')
  const curl = await run(
    [
      'curl',
      '-fsSL',
      'https://repo.45drives.com/repofiles/rocky/45drives-enterprise.repo',
      '-o',
      '/etc/yum.repos.d/45drives-enterprise.repo',
    ],
    env,
  )
  if (curl.code !== 0) {
    log('rocky-packages: WARN: failed to fetch 45Drives repo — skipping cockpit-zfs')
    return
  }
  await run(
    [
      'dnf',
      'config-manager',
      '--save',
      '--setopt=45drives_enterprise.excludepkgs=zfs*,libzfs*,kmod-zfs*,zfs-dkms*',
      '--setopt=45drives_enterprise.skip_if_unavailable=1',
    ],
    env,
  )
  const inst = await run(['dnf', 'install', '-y', 'cockpit-zfs'], env, { inherit: true })
  if (inst.code !== 0) {
    log(
      'rocky-packages: WARN: cockpit-zfs install failed (often python3-libzfs vs ZoL ABI); continuing',
    )
  }
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
  const wantCockpit = names.some((p) => p === 'cockpit' || p.startsWith('cockpit-'))
  const rest = names.filter((p) => p !== 'zfs')
  const doUpgrade = Boolean(opts.upgrade) && env.QCTL_SKIP_DNF_UPGRADE !== '1'

  if (!names.length && !doUpgrade) return

  await ensureDnfBootstrap(log, env)

  if (doUpgrade) {
    log('rocky-packages: dnf upgrade --refresh')
    const up = await run(['dnf', '-y', 'upgrade', '--refresh'], env, { inherit: true })
    if (up.code !== 0) throw new Error(`dnf upgrade failed (exit ${up.code})`)
  }

  if (wantZfs) await ensureZfs(log, env)

  if (rest.length > 0) {
    log(`rocky-packages: distro: installing ${rest.length} package(s) via dnf`)
    const r = await run(['dnf', 'install', '-y', ...rest], env, { inherit: true })
    if (r.code !== 0) throw new Error(`dnf install failed (exit ${r.code})`)
  }

  if (wantZfs) await enableZfsUnits(log, env)
  if (wantCockpit) await ensureCockpitZfs(log, env)
}
