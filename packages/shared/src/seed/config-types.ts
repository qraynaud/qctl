import type { z } from 'zod'

import type {
  osConfigSchema,
  seedAppsUserSchema,
  seedConfigSchema,
  seedInitTankSchema,
  seedProfileSchema,
  seedRepoSchema,
  seedSubidRangeSchema,
} from './config.js'

export type SeedProfile = z.infer<typeof seedProfileSchema>
export type SeedSubidRange = z.infer<typeof seedSubidRangeSchema>
export type SeedAppsUser = z.infer<typeof seedAppsUserSchema>
export type SeedRepo = z.infer<typeof seedRepoSchema>
export type SeedInitTank = z.infer<typeof seedInitTankSchema>
/** Non-secret ISO seed document (`qctl-seed/config.json`). */
export type SeedConfig = z.infer<typeof seedConfigSchema>
/** Non-secret guest runtime config (`/etc/qctl/config.json`). */
export type OsConfig = z.infer<typeof osConfigSchema>
