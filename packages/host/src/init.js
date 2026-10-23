import { mkdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { isInstanceRoot } from '@qctl/shared'

import { writeLayout } from './init/write-layout.js'
import {
  defaultQuickstartProvisionMeta,
  mergeWriteReports,
  writeProvision,
} from './init/write-provision.js'

/**
 * Scaffold a new instance repo.
 * @param {string} dir
 * @param {{ force?: boolean, name?: string }} [opts]
 */
export function initInstance(dir, opts = {}) {
  const root = resolve(dir)
  mkdirSync(root, { recursive: true })

  if (isInstanceRoot(root) && !opts.force) {
    throw new Error(
      `${root} already looks like a qctl instance (provision/ with qctl:). Pass --force to overwrite scaffold files.`,
    )
  }

  const layout = writeLayout(root, {
    force: opts.force,
    name: opts.name ?? basename(root),
  })

  const provision = writeProvision(root, {
    force: opts.force,
    meta: defaultQuickstartProvisionMeta(),
    // Sample Proxmox target stub for later `qctl new profile` (not wired into profiles yet).
    extraTargets: ['proxmox'],
    provisionEnvFiles: ['dev', 'prod'],
  })

  const report = mergeWriteReports(layout, provision)
  return { root, ...report }
}
