/**
 * Ensure missing instance scaffold (layout + provision) without overwriting
 * or re-injecting opinionated secret catalog keys.
 */
import { basename, resolve } from 'node:path'

import { writeLayout } from './write-layout.js'
import {
  defaultQuickstartProvisionMeta,
  mergeWriteReports,
  writeProvision,
} from './write-provision.js'

/** @import { LayoutReport } from './write-layout.js' */

/**
 * @param {string} dir
 * @param {{ dryRun?: boolean, name?: string, aiSkills?: boolean }} [opts]
 * @returns {{ root: string } & LayoutReport}
 */
export function ensureInstance(dir, opts = {}) {
  const root = resolve(dir)
  const layout = writeLayout(root, {
    force: false,
    dryRun: opts.dryRun,
    name: opts.name ?? basename(root),
    aiSkills: opts.aiSkills,
  })
  const provision = writeProvision(root, {
    force: false,
    dryRun: opts.dryRun,
    meta: defaultQuickstartProvisionMeta(),
    extraTargets: ['proxmox'],
    provisionEnvFiles: ['dev', 'prod'],
  })
  return { root, ...mergeWriteReports(layout, provision) }
}
