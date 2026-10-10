/**
 * NoCloud seed: stage cidata in tmp; keep ISO/FAT + instance-id under XDG cache.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import YAML from 'yaml'
import { $, chalk, fs, path } from 'zx'

import { gcQctlCache, touchPath } from './cache-gc.js'
import { renderNetworkConfigV2 } from './guest-net.js'
import { loadEnvSecrets } from './load-config.js'
import { getCloud, getRepoRoot, getSeed } from './paths.js'
import { parsePlatformRef } from './platform-ref.js'
import { ensurePlatformSeedKit } from './platform-tooling.js'
import { applyVcsFileDefaults } from './secrets-schema/files.js'
import { applyVcsPackageDefaults } from './secrets-schema/packages.js'
import {
  buildVars,
  injectGuestCredentialFiles,
  injectPackagesManifest,
  injectProvisionFiles,
  renderTemplate,
} from './seed-template.js'
import { die, requireBins, which } from './util.js'

/** @import { SeedProfile as VmSeedProfile, VmArgv } from '../types.js' */
/** @import { GuestFile } from './secrets-schema/files.js' */
/** @import { NormalizedPackages } from './secrets-schema/packages.js' */

/** @typedef {VmSeedProfile} SeedProfile */
/** @typedef {Awaited<ReturnType<typeof loadEnvSecrets>>} LoadedSecrets */

/** Profile templates (paths resolved per env via resolveSeedPaths). */
export const SEED_PROFILES = {
  appliance: {
    userData: 'user-data.yaml',
  },
  'init-tank': {
    // Same cloud-init template as appliance; `profile` Nunjucks switches the deltas.
    userData: 'user-data.yaml',
  },
}

/**
 * Packages embedded for a seed profile.
 * User `packages.pipx` / `http` / `distro` always apply (e.g. `bw` for vw plugins).
 * Auto mercurial+hg-evolve only for appliance (`vm up`) when `repo.vcs: hg`.
 *
 * @param {SeedProfile | string} profileName
 * @param {NormalizedPackages | undefined} packages
 * @param {string | undefined | null} vcs
 * @returns {NormalizedPackages}
 */
export function packagesForSeedProfile(profileName, packages, vcs) {
  const base = {
    distro: [...(packages?.distro || [])],
    pipx: [...(packages?.pipx || [])],
    http: [...(packages?.http || [])],
  }
  if (profileName === 'init-tank') return base
  return applyVcsPackageDefaults(base, vcs)
}

/**
 * Provision `files:` for a seed profile. Stock `/etc/mercurial/hgrc` only on appliance + hg.
 *
 * @param {SeedProfile | string} profileName
 * @param {GuestFile[] | undefined} files
 * @param {string | undefined | null} vcs
 * @returns {GuestFile[]}
 */
export function filesForSeedProfile(profileName, files, vcs) {
  const base = [...(files || [])]
  if (profileName === 'init-tank') return base
  return applyVcsFileDefaults(base, vcs)
}

/**
 * @param {LoadedSecrets} sec
 * @param {SeedProfile | string} profileName
 * @returns {LoadedSecrets}
 */
export function applySeedProfileDefaults(sec, profileName) {
  const vcs = sec.data?.repo?.vcs === 'hg' ? 'hg' : 'git'
  return {
    ...sec,
    packages: packagesForSeedProfile(profileName, sec.packages, vcs),
    files: filesForSeedProfile(profileName, sec.files, vcs),
  }
}

/**
 * Env-scoped seed artifact paths under `$XDG_CACHE_HOME/qctl/repos/<hash>/seed/<env>/`.
 * Durable outputs: nocloud.iso (preferred), cidata.img (fallback), instance-id.
 * @param {SeedProfile | string} profileName
 * @param {string} env
 */
export function resolveSeedPaths(profileName, env = 'dev') {
  const e = env || 'dev'
  const root = path.join(getSeed(), e)
  if (profileName === 'init-tank') {
    const base = path.join(root, 'init-tank')
    return {
      userData: 'user-data.yaml',
      root: base,
      isoName: 'nocloud.iso',
      isoPath: path.join(base, 'nocloud.iso'),
      imgName: 'cidata.img',
      imgPath: path.join(base, 'cidata.img'),
      instanceIdPath: path.join(base, 'instance-id'),
    }
  }
  return {
    userData: 'user-data.yaml',
    root,
    isoName: 'nocloud.iso',
    isoPath: path.join(root, 'nocloud.iso'),
    imgName: 'cidata.img',
    imgPath: path.join(root, 'cidata.img'),
    instanceIdPath: path.join(root, 'instance-id'),
  }
}

/**
 * Prefer ISO; else FAT img. Does not fall back to another env's artifacts.
 *
 * @param {{ isoPath?: string | null, imgPath?: string | null }} opts
 * @returns {Promise<{ path: string, format: 'raw', device: 'cdrom' | 'disk' }>}
 */
export async function ensureSeed({ isoPath, imgPath }) {
  if (isoPath && fs.existsSync(isoPath)) {
    console.log(chalk.dim(`vm: seed ISO ${isoPath}`))
    return { path: isoPath, format: 'raw', device: 'cdrom' }
  }
  if (imgPath && fs.existsSync(imgPath)) {
    console.log(chalk.dim(`vm: seed FAT ${imgPath}`))
    return { path: imgPath, format: 'raw', device: 'disk' }
  }
  die(
    `no seed ISO/FAT at ${isoPath || '(no iso)'} / ${imgPath || '(no img)'}`
      + `\n  Run: qctl vm seed --env <env>`
      + (isoPath && String(isoPath).includes('init-tank') ? ' --profile init-tank' : ''),
  )
}

/**
 * @param {string} stageDir
 * @param {string} imgPath
 */
async function buildFatImg(stageDir, imgPath) {
  await requireBins(['mkfs.vfat', 'mcopy', 'truncate'])
  console.log(chalk.cyan(`vm: building FAT seed ${imgPath} (label CIDATA)`))
  await fs.remove(imgPath).catch(() => {})
  await $`truncate -s 4M ${imgPath}`
  const mk = await $`mkfs.vfat -n CIDATA ${imgPath}`.nothrow()
  if (mk.exitCode !== 0) die(`mkfs.vfat failed for ${imgPath}`)

  for (const name of ['user-data', 'meta-data', 'network-config']) {
    const src = path.join(stageDir, name)
    if (!fs.existsSync(src)) continue
    const r = await $`mcopy -o -i ${imgPath} ${src} ::${name}`.nothrow()
    if (r.exitCode !== 0) die(`mcopy ${name} into seed failed`)
  }
  // Guest tooling lives only on the ISO path today; FAT is a last-resort NoCloud disk.
  console.log(chalk.green(`vm: seed disk ${imgPath}`))
}

/**
 * @param {string} stageDir
 * @param {string} isoPath
 * @returns {Promise<boolean>}
 */
async function buildIso(stageDir, isoPath) {
  const tmpIso = `${isoPath}.tmp`
  await fs.remove(tmpIso).catch(() => {})

  const tryCmds = [
    async () => {
      if (!(await which('xorriso'))) return false
      const r =
        await $`xorriso -as mkisofs -output ${tmpIso} -volid cidata -joliet -rock ${stageDir}`.nothrow()
      return r.exitCode === 0
    },
    async () => {
      if (!(await which('genisoimage'))) return false
      const r =
        await $`genisoimage -output ${tmpIso} -volid cidata -joliet -rock ${stageDir}`.nothrow()
      return r.exitCode === 0
    },
    async () => {
      if (!(await which('mkisofs'))) return false
      const r = await $`mkisofs -output ${tmpIso} -volid cidata -joliet -rock ${stageDir}`.nothrow()
      return r.exitCode === 0
    },
  ]

  for (const run of tryCmds) {
    if (await run()) {
      await fs.remove(isoPath).catch(() => {})
      await fs.move(tmpIso, isoPath)
      console.log(chalk.green(`vm seed: ISO -> ${isoPath}`))
      return true
    }
  }

  await fs.remove(tmpIso).catch(() => {})
  return false
}

/**
 * @param {string} instanceIdPath
 * @returns {string | null}
 */
function readExistingInstanceId(instanceIdPath) {
  if (!fs.existsSync(instanceIdPath)) return null
  try {
    const t = String(fs.readFileSync(instanceIdPath, 'utf8')).trim()
    return t || null
  } catch {
    return null
  }
}

/**
 * Candidate dirs for compiled guest artifacts (`bun run compile` → dist/).
 * @returns {string[]}
 */
function guestToolingDistDirs() {
  /** @type {string[]} */
  const dirs = []
  if (process.env.QCTL_GUEST_DIST) dirs.push(path.resolve(process.env.QCTL_GUEST_DIST))
  // Sibling qctl checkout (matches rocky's mise `_.path = ../qctl/bin`).
  dirs.push(path.resolve(getRepoRoot(), '..', 'qctl', 'dist'))
  return dirs
}

/**
 * Optional guest artifacts staged beside the binaries (name → candidate sources,
 * relative to the dist dir; first existing wins).
 * @type {Record<string, string[]>}
 */
/**
 * Copy compiled guest tooling into the staging cidata dir under `qctl-guest/`.
 * First-boot secrets come from provision YAML → Tier-0 pending (not a guest bootstrap graph).
 *
 * @param {string} stageDir temporary cidata directory
 * @param {{ platformModule?: string }} [opts] `qctl-platform-<id>.mjs` from `qctl.platform`
 * @returns {Promise<string[]>} basenames of the binaries copied
 */
export async function embedGuestTooling(stageDir, opts = {}) {
  const dest = path.join(stageDir, 'qctl-guest')
  await fs.mkdirp(dest)

  const platformModule = opts.platformModule || parsePlatformRef('rocky').moduleFile
  const names = ['qctl-guest']
  /** @type {string[]} */
  let found = []
  /** @type {string | null} */
  let distDir = null
  for (const dir of guestToolingDistDirs()) {
    const hit = names.filter((n) => fs.existsSync(path.join(dir, n)))
    if (hit.length === 0) continue
    found = hit
    distDir = dir
    break
  }

  if (distDir) {
    for (const n of found) {
      await fs.copyFile(path.join(distDir, n), path.join(dest, n))
      await fs.chmod(path.join(dest, n), 0o755)
    }
    console.log(chalk.dim(`  guest tooling: ${found.join(', ')} ← ${distDir}`))

    /** @type {string[]} */
    const extras = []
    const platformSrc = path.join(distDir, platformModule)
    if (fs.existsSync(platformSrc)) {
      await fs.copyFile(platformSrc, path.join(dest, platformModule))
      await fs.chmod(path.join(dest, platformModule), 0o644)
      extras.push(platformModule)
    } else {
      console.log(
        chalk.yellow(
          `  guest extras: missing ${platformModule} in ${distDir}`
            + ` (run \`bun run compile\` / set QCTL_GUEST_DIST)`,
        ),
      )
    }
    const encrypt = path.join(distDir, 'varlock-local-encrypt')
    if (fs.existsSync(encrypt)) {
      await fs.copyFile(encrypt, path.join(dest, 'varlock-local-encrypt'))
      await fs.chmod(path.join(dest, 'varlock-local-encrypt'), 0o755)
      extras.push('varlock-local-encrypt')
    } else {
      console.log(
        chalk.dim(
          '  note: varlock-local-encrypt not in dist — run `bun run compile` (stages the helper)',
        ),
      )
    }
    if (extras.length) console.log(chalk.dim(`  guest extras: ${extras.join(', ')}`))
  } else {
    console.log(
      chalk.dim(
        '  guest tooling: none found (run `bun run compile` in qctl or set QCTL_GUEST_DIST)',
      ),
    )
  }
  return found
}

/**
 * @param {Partial<Pick<VmArgv, 'profile' | 'env' | 'target' | 'out' | 'allowMissingTier0' | 'allowMissingFiles' | 'instanceId'>>} argv
 * @returns {Promise<{ isoPath: string, imgPath: string, profile: SeedProfile, env: string, instanceId: string, keepDir: string | null }>}
 */
export async function runSeed(argv) {
  /** @type {SeedProfile} */
  const profileName = /** @type {SeedProfile} */ (argv.profile || 'appliance')
  if (!SEED_PROFILES[profileName]) die(`unknown seed profile '${profileName}'`)

  const env = argv.env || 'dev'
  const target = argv.target || 'local'
  const paths = resolveSeedPaths(profileName, env)
  const keepDir =
    argv.out != null && String(argv.out).trim() !== '' ? path.resolve(String(argv.out)) : null
  const allowMissingTier0 = argv.allowMissingTier0
  const allowMissingFiles = argv.allowMissingFiles
  // Stable by default: up rebuilds nocloud.iso in place (still attached). A new
  // instance-id makes cloud-init re-run modules:final (packages, etc.).
  const prevId = readExistingInstanceId(paths.instanceIdPath)
  const instanceId =
    (argv.instanceId != null && String(argv.instanceId).trim() !== ''
      ? String(argv.instanceId).trim()
      : null)
    || prevId
    || `rocky-${env}`

  console.log(
    chalk.cyan('vm seed'),
    chalk.dim(`profile=${profileName} env=${env} target=${target} config=provision/`),
  )

  const secRaw = await loadEnvSecrets({ env, target })
  const sec = applySeedProfileDefaults(secRaw, profileName)
  await ensurePlatformSeedKit()

  const cloud = getCloud()
  const userDataPath = path.join(cloud, paths.userData)
  if (!fs.existsSync(userDataPath)) {
    die(`missing ${userDataPath}`)
  }

  const vars = await buildVars({
    instanceId,
    allowMissingTier0,
    env,
    target,
    secrets: sec,
    profile: profileName,
  })
  const userData = injectPackagesManifest(
    injectProvisionFiles(
      injectGuestCredentialFiles(
        renderTemplate(userDataPath, vars, allowMissingFiles),
        /** @type {Record<string, string> | undefined} */ (vars.secrets?.guest),
      ),
      /** @type {typeof sec.files | undefined} */ (vars.secrets?.files) || sec.files,
    ),
    /** @type {typeof sec.packages | undefined} */ (vars.secrets?.packages) || sec.packages,
  )
  const meta = renderTemplate(path.join(cloud, 'meta-data.yaml'), vars, allowMissingFiles)
  const network = renderNetworkConfigV2(sec.uplinks, sec.vlans)

  const userDataOut = `#cloud-config\n${YAML.stringify(userData, { lineWidth: 0 })}`
  const metaOut = YAML.stringify(meta, { lineWidth: 0 })

  await fs.mkdirp(paths.root)

  const stageDir = mkdtempSync(path.join(tmpdir(), 'qctl-seed-'))
  /** @type {string} */
  const isoPath = paths.isoPath
  /** @type {string} */
  const imgPath = paths.imgPath
  try {
    await fs.writeFile(path.join(stageDir, 'user-data'), userDataOut)
    await fs.writeFile(path.join(stageDir, 'meta-data'), metaOut)
    await fs.writeFile(path.join(stageDir, 'network-config'), network)
    let platformModule = parsePlatformRef('rocky').moduleFile
    try {
      platformModule = parsePlatformRef(sec.platform).moduleFile
    } catch (err) {
      die(err instanceof Error ? err.message : String(err))
    }
    await embedGuestTooling(stageDir, { platformModule })

    const isoOk = await buildIso(stageDir, isoPath)
    if (isoOk) {
      await fs.remove(imgPath).catch(() => {})
    } else {
      console.warn(
        chalk.yellow(
          'vm seed: no xorriso/genisoimage/mkisofs — writing FAT cidata.img instead.\n'
            + '  Install e.g. `sudo pacman -S cdrtools` or `xorriso` for ISO attach.',
        ),
      )
      await buildFatImg(stageDir, imgPath)
      await fs.remove(isoPath).catch(() => {})
    }

    await fs.writeFile(paths.instanceIdPath, `${instanceId}\n`, 'utf8')
    // Drop any previous unpacked cidata tree under the seed cache root.
    await fs.remove(path.join(paths.root, 'cidata')).catch(() => {})

    if (keepDir) {
      await fs.remove(keepDir).catch(() => {})
      await fs.copy(stageDir, keepDir)
      console.log(chalk.dim(`  keep-cidata: ${keepDir}`))
    }
  } finally {
    await fs.remove(stageDir).catch(() => {})
  }

  for (const p of [isoPath, imgPath, paths.instanceIdPath]) {
    if (fs.existsSync(p)) touchPath(p)
  }
  gcQctlCache()

  const kept = isoPath && fs.existsSync(isoPath) ? isoPath : imgPath
  console.log(chalk.green(`vm seed: wrote ${kept}`))
  console.log(chalk.dim(`  profile=${profileName} env=${env} instance-id=${instanceId}`))
  console.log(chalk.dim(`  iso=${isoPath}`))
  return {
    isoPath,
    imgPath,
    profile: profileName,
    env,
    instanceId,
    keepDir,
  }
}
