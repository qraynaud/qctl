import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

import { findInstanceRoot, loadProvision } from '@qctl/shared'

import { portsFromArgv } from '../lib/options.js'
import { resolveProfileArgv } from '../lib/profile-argv.js'
import { which } from '../lib/util.js'
import { adminIdentityFromProvision } from '../provision/schema/first-boot.js'
import {
  appsIdentityFromProvision,
  dummyInterfaceNames,
  parseProvisionOrThrow,
} from '../provision/schema/index.js'
import { ensureGuestTooling } from '../tooling/guest-tooling.js'
import { localDiskMounts } from './disk-mounts.js'
import { localContainerName, localTestContainerName } from './name.js'
import { localPublishPodmanArgs } from './ports-publish.js'
import { localApplianceUidMapArgs } from './uidmap.js'
import { die } from './util.js'

/** @import { PortsMap } from '../vm/types.js' */
/** @import { DisksMountSource, LocalDiskMount } from './disk-mounts.js' */

/**
 * @typedef {object} LocalContext
 * @property {string} root
 * @property {string} env
 * @property {string} name
 * @property {string} repoDir guest path for the instance bind (`repo.dir`)
 * @property {LocalDiskMount[]} diskMounts ISO binds from provision disks
 * @property {string} appsUsername
 * @property {number} appsUid
 * @property {number} appsGid
 * @property {{ start: number, count: number }} appsSubuid from provision
 * @property {{ start: number, count: number }} appsSubgid from provision
 * @property {string} adminUsername
 * @property {number} adminUid
 * @property {number} adminGid
 * @property {{ vcs: 'git' | 'hg', url?: string, branch?: string }} repo
 * @property {string} guestBin
 * @property {string | null} encryptPath varlock-local-encrypt beside guest (optional)
 * @property {string} platformModulePath
 * @property {string} platformBasename
 * @property {string} image
 * @property {PortsMap} ports
 * @property {string[]} dummyIfaces type:dummy iface names from provision (sorted)
 * @property {string[]} publishArgs
 * @property {string[]} uidMapArgs
 */

/**
 * Guest checkout path from provision `repo.dir` (required for `qctl local`).
 * @param {{ dir?: string } | null | undefined} repo
 * @returns {string}
 */
export function localRepoDir(repo) {
  const dir = repo?.dir?.trim()
  if (!dir) {
    die('provision repo.dir is required for qctl local (guest path for the instance bind)')
  }
  return dir
}

/**
 * Ensure host dirs exist for each local disk mount (`volumes/tank|data/<key>`).
 * @param {string} instanceRoot
 * @param {LocalDiskMount[]} mounts
 */
export function ensureLocalDiskHostDirs(instanceRoot, mounts) {
  for (const m of mounts) {
    mkdirSync(join(instanceRoot, m.hostRel), { recursive: true })
  }
}

/**
 * @param {{ env?: string, profile?: string, target?: string, production?: boolean }} argv
 * @param {{ disposable?: boolean }} [opts] `disposable` → unique `-test-<id>` name, no host `-p`
 * @returns {Promise<LocalContext>}
 */
export async function createLocalContext(argv, opts = {}) {
  if (!(await which('podman'))) {
    die('podman is required on the host (install podman and retry)')
  }

  const root = findInstanceRoot(process.cwd())
  if (!root) {
    die(
      `not inside a qctl instance repo (no provision/*.yaml with a qctl: block above ${process.cwd()})\n`
        + '  Run `qctl init <dir>` to scaffold one, or cd into an existing instance.',
    )
  }
  resolveProfileArgv(argv, { root, requireWorkstation: true })
  const env = String(argv.env || 'dev')
  const disposable = opts.disposable === true
  const name = disposable ? localTestContainerName(root) : localContainerName(root)

  const loaded = await loadProvision({
    root,
    env,
    target: 'workstation',
    profile: /** @type {string} */ (argv.profile),
    processEnv: { ...process.env, QCTL_ENV: env },
  })
  const sourceLabel =
    [loaded.commonPath, loaded.targetPath, loaded.envPath, loaded.profilePath]
      .filter(Boolean)
      .map((p) => basename(/** @type {string} */ (p)))
      .join(' + ') || 'provision'
  const data = parseProvisionOrThrow(loaded.data, sourceLabel)
  const apps = appsIdentityFromProvision(data)
  const admin = adminIdentityFromProvision(data)
  const appsUsername = apps.username
  const appsUid = apps.uid
  const appsGid = apps.gid
  const appsSubuid = apps.subuid
  const appsSubgid = apps.subgid
  const adminUsername = admin.username
  const adminUid = admin.uid
  const adminGid = admin.gid
  const repoDir = localRepoDir(data.repo)
  const repoRaw = /** @type {{ vcs?: string, url?: string, branch?: string }} */ (data.repo || {})
  /** @type {{ vcs: 'git' | 'hg', url?: string, branch?: string }} */
  const repo = { vcs: repoRaw.vcs === 'hg' ? 'hg' : 'git' }
  if (repoRaw.url) repo.url = String(repoRaw.url)
  if (repoRaw.branch) repo.branch = String(repoRaw.branch)

  const diskMounts = localDiskMounts(/** @type {DisksMountSource | undefined} */ (data.disks))
  ensureLocalDiskHostDirs(root, diskMounts)

  const tooling = await ensureGuestTooling({
    env,
    target: 'workstation',
    required: true,
    quiet: true,
    // Avoid loadEnvProvision (ssh.authorized_keys warning) — we already have provision.
    platform: data.qctl.platform,
  })
  if (!tooling) {
    die('failed to resolve qctl-guest / platform module')
  }

  const ports = portsFromArgv(argv)
  const image = process.env.QCTL_LOCAL_IMAGE?.trim() || 'quay.io/podman/stable:latest'
  const dummyIfaces = dummyInterfaceNames(data.networking.interfaces)

  return {
    root,
    env,
    name,
    repoDir,
    diskMounts,
    appsUsername,
    appsUid,
    appsGid,
    appsSubuid,
    appsSubgid,
    adminUsername,
    adminUid,
    adminGid,
    repo,
    guestBin: tooling.guestPath,
    encryptPath: tooling.encryptPath,
    platformModulePath: tooling.platformModulePath,
    platformBasename: basename(tooling.platformModulePath),
    image,
    ports,
    dummyIfaces,
    // Disposable tests skip host publishes so concurrent runs do not fight for forwards.
    publishArgs: disposable ? [] : localPublishPodmanArgs(ports),
    uidMapArgs: localApplianceUidMapArgs(appsUid, appsGid, appsSubuid, appsSubgid),
  }
}
