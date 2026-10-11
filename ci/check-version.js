#!/usr/bin/env bun
/**
 * Ensure qctl binary release versions agree:
 *   root package.json  ↔  QCTL_VERSION
 *
 * `@qctl/vaultwarden-plugin` has its own version (npm-only); not checked here.
 */
import { QCTL_VERSION } from '@qctl/shared'

import pkg from '../package.json' with { type: 'json' }

const rootVersion = pkg.version
if (!rootVersion || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(rootVersion)) {
  console.error(`invalid root package.json version: ${JSON.stringify(rootVersion)}`)
  process.exit(1)
}

if (QCTL_VERSION !== rootVersion) {
  console.error(
    `version mismatch:\n  QCTL_VERSION (${QCTL_VERSION}) !== package.json (${rootVersion})`,
  )
  process.exit(1)
}

console.log(rootVersion)
