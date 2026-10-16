import type { z } from 'zod'

import type { disksJsonSchema } from './disks-json.js'

/** Guest seed `disks.json` (resolved topology without passphrases). */
export type DisksJson = z.infer<typeof disksJsonSchema>

/** Capability hints derived from {@link DisksJson} for guest package install. */
export type DisksPackageHints = {
  /** Unique `disks.data.*.fs` values (platform capability names). */
  filesystems: string[]
  hasTanks: boolean
}
