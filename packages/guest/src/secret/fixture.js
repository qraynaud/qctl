/**
 * Test fixtures: an instance with real (tiny) unit varlock schemas, and a PATH shim
 * for podman. Secrets are literals in the unit schema, so the real varlock graph resolves them
 * without Vaultwarden.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, writeFile, writeMinimalInstance } from '../../../shared/src/test-helpers.js'

/**
 * caddy: CADDY_DNS (rootless).
 * ad: ACTIVE_DIRECTORY_ADMIN_PASSWORD (rootful via app.yaml) + plain var.
 * @returns {string} root
 */
export function makeSecretInstance() {
  const root = makeTempDir()
  writeMinimalInstance(root, { withEnvRefs: false, withSchema: false, withOverlay: false })
  writeFile(root, 'applications/caddy/app.yaml', 'engine: rootless\n')
  writeFile(
    root,
    'applications/caddy/caddy/.env.schema',
    '# ---\n# @sensitive @required\nCADDY_DNS=real-dns-token\n',
  )
  writeFile(root, 'applications/ad/app.yaml', 'engine: rootful\n')
  writeFile(
    root,
    'applications/ad/ad/.env.schema',
    '# ---\n# @public\nAD_IP=10.0.0.1\n# @sensitive @required\nACTIVE_DIRECTORY_ADMIN_PASSWORD=real-ad-pass\n',
  )
  writeFile(root, 'applications/noschema/app.yaml', 'engine: rootless\n')
  return root
}

/**
 * Executable bash `podman` shim in a fresh dir: logs argv and stores `secret create` stdin
 * @returns {{ dir: string, logDir: string, env: Record<string, string> }}
 */
export function makeShims() {
  const dir = makeTempDir()
  const logDir = join(dir, 'log')
  mkdirSync(logDir, { recursive: true })
  writeFileSync(
    join(dir, 'podman'),
    `#!/usr/bin/env bash
echo "$*" >>"${logDir}/podman.log"
if [ "$1 $2" = "secret create" ]; then
  shift 2
  name=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --label) shift 2 ;;
      -) shift ;;
      *) name="$1"; shift ;;
    esac
  done
  cat >"${logDir}/secret.\${name}"
  exit 0
fi
if [ "$1 $2" = "secret exists" ]; then exit 1; fi
if [ "$1 $2" = "secret inspect" ]; then exit 1; fi
exit 0
`,
  )
  chmodSync(join(dir, 'podman'), 0o755)
  return {
    dir,
    logDir,
    env: {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
    },
  }
}
