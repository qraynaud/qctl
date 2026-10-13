import { basename } from 'node:path'

import { findInstanceRoot, loadProvision } from '@qctl/shared'

import { portsFromArgv } from '../lib/options.js'
import { which } from '../lib/util.js'
import { appsIdentityFromProvision, parseSecretsFile } from '../provision/secrets-schema/index.js'
import { defaultAppsSubidRange } from '../provision/secrets-schema/users.js'
import { ensureGuestTooling } from '../tooling/guest-tooling.js'
import { localContainerName, localTestContainerName } from './name.js'
import { localPublishPodmanArgs } from './ports-publish.js'
import { DEFAULT_APPS_IDS, localApplianceUidMapArgs } from './uidmap.js'
import { die } from './util.js'

/** @import { YamlMapping } from '@qctl/shared' */
/** @import { PortEntry } from '../vm/types.js' */

/**
 * @typedef {object} LocalContext
 * @property {string} root
 * @property {string} env
 * @property {string} name
 * @property {string} appsUsername
 * @property {number} appsUid
 * @property {number} appsGid
 * @property {{ start: number, count: number }} appsSubuid from provision
 * @property {{ start: number, count: number }} appsSubgid from provision
 * @property {string} guestBin
 * @property {string} platformModulePath
 * @property {string} platformBasename
 * @property {string} image
 * @property {PortEntry[]} ports
 * @property {string[]} publishArgs
 * @property {string[]} uidMapArgs
 */

/**
 * @param {{ env?: string }} argv
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
  const env = String(argv.env || 'dev')
  const disposable = opts.disposable === true
  const name = disposable ? localTestContainerName(root) : localContainerName(root)

  const loaded = await loadProvision({
    root,
    env,
    target: 'local',
    processEnv: { ...process.env, QCTL_ENV: env },
  })
  const qctlBlock = /** @type {YamlMapping | undefined} */ (
    /** @type {YamlMapping} */ (loaded.data).qctl
  )
  const platformFromProvision =
    qctlBlock && typeof qctlBlock.platform === 'string' ? qctlBlock.platform.trim() : ''
  const raw = /** @type {YamlMapping} */ ({ ...loaded.data })
  delete raw.qctl
  const parsed = parseSecretsFile(raw, loaded.basePath)
  const apps = appsIdentityFromProvision(/** @type {YamlMapping} */ (parsed.data))
  const appsUsername = apps?.username ?? 'apps'
  const appsUid = apps?.uid ?? DEFAULT_APPS_IDS.appsUid
  const appsGid = apps?.gid ?? DEFAULT_APPS_IDS.appsGid
  const appsSubuid = apps?.subuid ?? defaultAppsSubidRange(appsUid)
  const appsSubgid = apps?.subgid ?? defaultAppsSubidRange(appsGid)

  const tooling = await ensureGuestTooling({
    env,
    target: 'local',
    required: true,
    quiet: true,
    // Avoid loadEnvSecrets (ssh.authorized_keys warning) — we already have provision.
    platform: platformFromProvision || 'rocky',
  })
  if (!tooling) {
    die('failed to resolve qctl-guest / platform module')
  }

  const ports = portsFromArgv({ env, target: 'local' })
  const image = process.env.QCTL_LOCAL_IMAGE?.trim() || 'quay.io/podman/stable:latest'

  return {
    root,
    env,
    name,
    appsUsername,
    appsUid,
    appsGid,
    appsSubuid,
    appsSubgid,
    guestBin: tooling.guestPath,
    platformModulePath: tooling.platformModulePath,
    platformBasename: basename(tooling.platformModulePath),
    image,
    ports,
    // Disposable tests skip host publishes so concurrent runs do not fight for forwards.
    publishArgs: disposable ? [] : localPublishPodmanArgs(ports),
    uidMapArgs: localApplianceUidMapArgs(appsUid, appsGid, appsSubuid, appsSubgid),
  }
}
