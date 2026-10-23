/**
 * Shared fixtures for bun:test (temp instance trees).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * @returns {string}
 */
export function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'qctl-test-'))
}

/**
 * @param {string} dir
 */
export function removeTempDir(dir) {
  rmSync(dir, { recursive: true, force: true })
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
