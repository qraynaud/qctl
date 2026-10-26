/**
 * `qctl host vm seed` orchestration (render → stage → ISO).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import YAML from 'yaml'
import { chalk, fs, path } from 'zx'

import { loadEnvProvision } from '../../../lib/load-config.js'
import { getCloud } from '../../../lib/paths.js'
import { die } from '../../../lib/util.js'
import { gcQctlCache, touchPath } from '../../../tooling/cache-gc.js'
import { parsePlatformRef } from '../../../tooling/platform-ref.js'
import { ensurePlatformSeedKit } from '../../../tooling/platform-tooling.js'
import { injectProvisionFiles } from '../seed-template/inject.js'
import { renderTemplate } from '../seed-template/njk.js'
import { buildSeedConfig, stageSeedTree } from '../seed-template/seed-tree.js'
import { buildVars } from '../seed-template/vars.js'
import { buildIso, readExistingInstanceId, resolveSeedPaths } from './iso.js'
import { SEED_PROFILES, applySeedProfileDefaults } from './profiles.js'
import { embedGuestTooling } from './tooling.js'

/** @import { SeedProfile as VmSeedProfile, VmArgv } from '../../types.js' */

/** @typedef {VmSeedProfile} SeedProfile */

/**
 * @param {Partial<
 *   Pick<
 *     VmArgv,
 *     | 'seedProfile'
 *     | 'profile'
 *     | 'env'
 *     | 'target'
 *     | 'out'
 *     | 'allowMissingTier0'
 *     | 'allowMissingFiles'
 *     | 'instanceId'
 *   >
 * > & {
 *   initTankPools?: string[],
 *   initTankForce?: boolean,
 * }} argv
 * @returns {Promise<{
 *   isoPath: string,
 *   imgPath: string,
 *   profile: SeedProfile,
 *   env: string,
 *   instanceId: string,
 *   keepDir: string | null,
 * }>}
 */
export async function runSeed(argv) {
  /** @type {SeedProfile} */
  const profileName = /** @type {SeedProfile} */ (argv.seedProfile || 'appliance')
  if (!SEED_PROFILES[profileName]) die(`unknown seed profile '${profileName}'`)

  const env = argv.env || 'dev'
  const target = argv.target || 'workstation'
  const provisionProfile = argv.profile
  if (provisionProfile == null || String(provisionProfile).trim() === '') {
    die('vm seed: profile is required (pass --profile or set qctl.default-profile)')
  }
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

  const secRaw = await loadEnvProvision({ env, target, profile: provisionProfile })
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
    provision: sec,
    profile: profileName,
    initTankPools: argv.initTankPools,
    initTankForce: argv.initTankForce,
  })
  // Disks / ports / packages / Tier-0 / env live on ISO `qctl-seed/` (guest load-seed).
  // Provision `files:` remain cloud-init write_files only.
  const userData = injectProvisionFiles(
    renderTemplate(userDataPath, vars, allowMissingFiles),
    vars.provision.files || sec.files,
  )
  const meta = renderTemplate(path.join(cloud, 'meta-data.yaml'), vars, allowMissingFiles)

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

    // Provision `files:` remain cloud-init-only (not in qctl-seed/config.json).
    const seedConfig = buildSeedConfig(vars)
    await stageSeedTree(stageDir, {
      config: seedConfig,
      tier0: /** @type {Record<string, string | Buffer>} */ (vars.provision.guest || {}),
    })
    console.log(
      chalk.dim(
        `  qctl-seed: config.json + tier0/${seedConfig.tier0Keys.length} key(s)`
          + ` (${seedConfig.tier0Keys.join(', ') || 'none'})`,
      ),
    )

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
