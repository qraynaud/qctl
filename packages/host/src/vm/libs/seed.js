/**
 * NoCloud seed: stage cidata in tmp; keep ISO + instance-id under XDG cache.
 */

import { mkdtempSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'

import { ISOWriter } from '@gcu/iso9660'
import YAML from 'yaml'
import { chalk, fs, path } from 'zx'

import { loadEnvSecrets } from '../../lib/load-config.js'
import { getCloud, getSeed } from '../../lib/paths.js'
import { die } from '../../lib/util.js'
import { applyVcsFileDefaults } from '../../provision/secrets-schema/files.js'
import { applyVcsPackageDefaults } from '../../provision/secrets-schema/packages.js'
import { gcQctlCache, touchPath } from '../../tooling/cache-gc.js'
import { ensureGuestTooling } from '../../tooling/guest-tooling.js'
import { parsePlatformRef } from '../../tooling/platform-ref.js'
import { ensurePlatformSeedKit } from '../../tooling/platform-tooling.js'
import { renderNetworkConfigV2 } from './guest-net.js'
import {
  buildVars,
  injectGuestCredentialFiles,
  injectPackagesManifest,
  injectProvisionFiles,
  renderTemplate,
} from './seed-template.js'

/** @import { GuestFile } from '../../provision/secrets-schema/files.js' */
/** @import { NormalizedPackages } from '../../provision/secrets-schema/packages.js' */
/** @import { SeedProfile as VmSeedProfile, VmArgv } from '../types.js' */

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
 * Durable outputs: nocloud.iso + instance-id (`cidata.img` is legacy read-only).
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
 * Prefer ISO; legacy FAT img still accepted if present from older seeds.
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
    console.log(chalk.dim(`vm: seed FAT ${imgPath} (legacy)`))
    return { path: imgPath, format: 'raw', device: 'disk' }
  }
  die(
    `no seed ISO at ${isoPath || '(no iso)'}`
      + `\n  Run: qctl vm seed --env <env>`
      + (isoPath && String(isoPath).includes('init-tank') ? ' --profile init-tank' : ''),
  )
}

/**
 * Walk a stage directory into flat ISO paths (files only; skip empty).
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {Promise<{ path: string, data: Uint8Array }[]>}
 */
async function collectStageFiles(dir, prefix = '') {
  /** @type {{ path: string, data: Uint8Array }[]} */
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name
    const abs = pathJoin(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...(await collectStageFiles(abs, rel)))
      continue
    }
    if (!ent.isFile()) continue
    const buf = await readFile(abs)
    if (buf.byteLength === 0) {
      console.log(chalk.dim(`  seed ISO: skip empty ${rel}`))
      continue
    }
    out.push({ path: rel, data: new Uint8Array(buf) })
  }
  return out
}

/**
 * Build a NoCloud ISO (label `cidata`, Joliet) with pure JS — no host ISO tools.
 * @param {string} stageDir
 * @param {string} isoPath
 */
async function buildIso(stageDir, isoPath) {
  const files = await collectStageFiles(stageDir)
  const names = new Set(files.map((f) => f.path))
  if (!names.has('user-data') || !names.has('meta-data')) {
    die('seed stage missing user-data or meta-data')
  }

  const writer = new ISOWriter({
    volumeId: 'cidata',
    joliet: true,
    greeting: false,
    application: 'qctl',
  })
  for (const f of files) writer.add(f.path, f.data)

  const iso = writer.toUint8Array()
  const tmpIso = `${isoPath}.tmp`
  await fs.remove(tmpIso).catch(() => {})
  await fs.writeFile(tmpIso, iso)
  await fs.remove(isoPath).catch(() => {})
  await fs.move(tmpIso, isoPath)
  console.log(chalk.green(`vm seed: ISO -> ${isoPath}`))
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
 * Stage guest tooling into the cidata dir under `qctl-guest/`.
 * Prefer `QCTL_GUEST_DIST`, else checkout `dist/` when running from a qctl repo,
 * else GitHub release assets (`qctl.platform` / host version).
 * First-boot secrets come from provision YAML → Tier-0 pending.
 *
 * @param {string} stageDir temporary cidata directory
 * @param {{
 *   platformModule?: string,
 *   env?: string,
 *   target?: string,
 *   platform?: string,
 * }} [opts]
 * @returns {Promise<string[]>} basenames of the primary binaries copied (`qctl-guest` when present)
 */
export async function embedGuestTooling(stageDir, opts = {}) {
  const dest = path.join(stageDir, 'qctl-guest')
  await fs.mkdirp(dest)

  const resolved = await ensureGuestTooling({
    env: opts.env,
    target: opts.target,
    platform: opts.platform,
    platformModule: opts.platformModule,
    // Soft-fail only when an explicit local dist override is incomplete (tests / dry paths).
    required: !process.env.QCTL_GUEST_DIST?.trim(),
  })
  if (!resolved) return []

  await fs.copyFile(resolved.guestPath, path.join(dest, 'qctl-guest'))
  await fs.chmod(path.join(dest, 'qctl-guest'), 0o755)

  await fs.copyFile(resolved.platformModulePath, path.join(dest, resolved.platformModule))
  await fs.chmod(path.join(dest, resolved.platformModule), 0o644)

  /** @type {string[]} */
  const extras = [resolved.platformModule]
  if (resolved.encryptPath) {
    await fs.copyFile(resolved.encryptPath, path.join(dest, 'varlock-local-encrypt'))
    await fs.chmod(path.join(dest, 'varlock-local-encrypt'), 0o755)
    extras.push('varlock-local-encrypt')
  }

  console.log(chalk.dim(`  guest tooling: qctl-guest ← ${resolved.sourceLabel}`))
  console.log(chalk.dim(`  guest extras: ${extras.join(', ')}`))
  return ['qctl-guest']
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
    let platformModule
    try {
      platformModule = parsePlatformRef(sec.platform).moduleFile
    } catch (err) {
      die(err instanceof Error ? err.message : String(err))
    }
    await embedGuestTooling(stageDir, {
      platform: sec.platform || undefined,
      platformModule,
      env,
      target,
    })

    await buildIso(stageDir, isoPath)
    // Drop legacy FAT seed if present from older qctl versions.
    await fs.remove(imgPath).catch(() => {})

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

  console.log(chalk.green(`vm seed: wrote ${isoPath}`))
  console.log(chalk.dim(`  profile=${profileName} env=${env} instance-id=${instanceId}`))
  return {
    isoPath,
    imgPath,
    profile: profileName,
    env,
    instanceId,
    keepDir,
  }
}
