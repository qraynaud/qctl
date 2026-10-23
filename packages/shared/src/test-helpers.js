/**
 * Shared fixtures for bun:test (temp instance trees).
 *
 * Every {@link makeTempDir} is registered; `tooling/test-preload.js` removes
 * leftovers after each test (and on process exit), plus a prefix scrub for
 * known test-only `/tmp` names that bypassed this helper.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** @type {Set<string>} */
const liveTemps = new Set()

/**
 * Basenames under `os.tmpdir()` that tests may leave behind.
 * Matches `/tmp/qctl-*`, `/tmp/tank-pass-*`, `/tmp/admin-stage-*` (and
 * `ssh-host-keys-*`). Never touches the user's `qctl-lab` tree.
 * @param {string} name
 */
export function isTestTempBasename(name) {
  if (name === 'qctl-lab' || name.startsWith('qctl-lab')) return false
  return (
    name.startsWith('qctl-')
    || name.startsWith('tank-pass-')
    || name.startsWith('admin-stage-')
    || name.startsWith('ssh-host-keys-')
  )
}

/** @deprecated Prefer {@link isTestTempBasename}; kept for callers that listed prefixes. */
export const TEST_TEMP_PREFIXES = Object.freeze([
  'qctl-',
  'tank-pass-',
  'admin-stage-',
  'ssh-host-keys-',
])

/**
 * @param {string} [prefix] mkdtemp prefix under `os.tmpdir()` (default `qctl-test-`)
 * @returns {string}
 */
export function makeTempDir(prefix = 'qctl-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  liveTemps.add(dir)
  return dir
}

/**
 * @param {string} dir
 */
export function removeTempDir(dir) {
  liveTemps.delete(dir)
  rmSync(dir, { recursive: true, force: true })
}

/** Remove every dir still tracked by {@link makeTempDir}. */
export function removeAllTempDirs() {
  for (const dir of [...liveTemps]) {
    removeTempDir(dir)
  }
}

/**
 * Delete leftover entries in `os.tmpdir()` matching {@link isTestTempBasename}
 * (safety net for raw `mkdtemp` / crashed cleans / untracked prefixes).
 */
export function scrubTestTempPrefixes() {
  const root = tmpdir()
  let names = []
  try {
    names = readdirSync(root)
  } catch {
    return
  }
  for (const name of names) {
    if (!isTestTempBasename(name)) continue
    const full = join(root, name)
    rmSync(full, { recursive: true, force: true })
    liveTemps.delete(full)
  }
}

/**
 * Minimal initialized instance (provision + qctl:).
 * @param {string} [root]
 * @param {{ withEnvRefs?: boolean, withSchema?: boolean, withOverlay?: boolean }} [opts]
 */
export function writeMinimalInstance(root = makeTempDir(), opts = {}) {
  const { withEnvRefs = true, withSchema = true, withOverlay = true } = opts
  mkdirSync(join(root, 'provision'), { recursive: true })

  const secretLine = withEnvRefs ? '  client_id: !env VW_CLIENT_ID\n' : '  client_id: "plain"\n'

  writeFileSync(
    join(root, 'provision', 'env-dev.yaml'),
    `qctl:\n  platform: rocky\nvaultwarden:\n${secretLine}`,
    'utf8',
  )

  if (withOverlay) {
    writeFileSync(join(root, 'provision', 'profile-lab.yaml'), 'workstation:\n  cpu: 2\n', 'utf8')
    writeFileSync(
      join(root, 'provision', 'target-proxmox.yaml'),
      withEnvRefs
        ? 'proxmox:\n  api_token: !env PROXMOX_API_TOKEN\n'
        : 'proxmox:\n  api_token: "tok"\n',
      'utf8',
    )
  }

  if (withSchema) {
    writeFileSync(join(root, '.env.schema'), '# ---\n# @public\nQCTL_ENV=dev\n', 'utf8')
  }

  return root
}

/**
 * Write a file (creating parent dirs).
 * @param {string} root
 * @param {string} rel
 * @param {string} content
 */
export function writeFile(root, rel, content) {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content, 'utf8')
}
