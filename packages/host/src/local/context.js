import { basename } from 'node:path'

import { findInstanceRoot, loadProvision } from '@qctl/shared'

import { portsFromArgv } from '../lib/options.js'
import { resolveProfileArgv } from '../lib/profile-argv.js'
import { which } from '../lib/util.js'
import { appsIdentityFromProvision, parseProvisionOrThrow } from '../provision/schema/index.js'
import { ensureGuestTooling } from '../tooling/guest-tooling.js'
import { localContainerName, localTestContainerName } from './name.js'
import { localPublishPodmanArgs } from './ports-publish.js'
import { localApplianceUidMapArgs } from './uidmap.js'
import { die } from './util.js'

/** @import { PortsMap } from '../vm/types.js' */

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
 * @property {PortsMap} ports
 * @property {string[]} publishArgs
 * @property {string[]} uidMapArgs
 */

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
  const appsUsername = apps.username
  const appsUid = apps.uid
  const appsGid = apps.gid
  const appsSubuid = apps.subuid
  const appsSubgid = apps.subgid

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
