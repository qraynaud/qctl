#!/usr/bin/env bun
/**
 * GitHub release notes: commit-subject changelog + short asset list.
 * Tag/title on GitHub already carry the version — body stays changelog + assets.
 */
import { buildChangelog } from './release-changelog.js'

const { markdown: changelog } = buildChangelog()

process.stdout.write(`## Changelog

${changelog}

## Assets
- \`qctl-host\` — workstation CLI
- \`qctl-guest\` — appliance CLI
- \`qctl-platform-rocky.mjs\` — Rocky platform module
`)
