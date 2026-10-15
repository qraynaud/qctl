/**
 * Tank pool / dataset / ACL options (provision tanks + guest disks.json).
 */
import { z } from 'zod'

import { DEFAULT_TANK_OPTIONS } from './constants.js'

// `.prefault({})` (not `.default({})`): omitted keys are parsed as `{}` so field
// defaults apply. Zod `.default({})` returns the literal and skips inner defaults.
const tankPoolOptionsSchema = z
  .strictObject({
    ashift: z.number().int().positive().default(DEFAULT_TANK_OPTIONS.pool.ashift),
    autotrim: z.string().trim().min(1).default(DEFAULT_TANK_OPTIONS.pool.autotrim),
    autoexpand: z.string().trim().min(1).default(DEFAULT_TANK_OPTIONS.pool.autoexpand),
    failmode: z.string().trim().min(1).default(DEFAULT_TANK_OPTIONS.pool.failmode),
  })
  .prefault({})

const tankDatasetOptionsSchema = z
  .strictObject({
    compression: z.string().trim().min(1).default(DEFAULT_TANK_OPTIONS.dataset.compression),
    atime: z.string().trim().min(1).default(DEFAULT_TANK_OPTIONS.dataset.atime),
    xattr: z.string().trim().min(1).default(DEFAULT_TANK_OPTIONS.dataset.xattr),
    special_small_blocks: z
      .number()
      .int()
      .nonnegative()
      .default(DEFAULT_TANK_OPTIONS.dataset.special_small_blocks),
  })
  .prefault({})

const tankAclOptionsSchema = z
  .strictObject({
    acltype: z.string().trim().min(1).default(DEFAULT_TANK_OPTIONS.acl.acltype),
    aclmode: z.string().trim().min(1).default(DEFAULT_TANK_OPTIONS.acl.aclmode),
    aclinherit: z.string().trim().min(1).default(DEFAULT_TANK_OPTIONS.acl.aclinherit),
  })
  .prefault({})

export const tankOptionsSchema = z
  .strictObject({
    pool: tankPoolOptionsSchema,
    dataset: tankDatasetOptionsSchema,
    acl: tankAclOptionsSchema,
  })
  .prefault({})
