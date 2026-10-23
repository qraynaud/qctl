import type { z } from 'zod'

import type { tankOptionsSchema } from './tank-options.js'

/** Parsed tank pool/dataset/acl options (defaults applied). */
export type TankOptions = z.infer<typeof tankOptionsSchema>
/** Pre-default tank options (writers may set a subset). */
export type TankOptionsInput = z.input<typeof tankOptionsSchema>
