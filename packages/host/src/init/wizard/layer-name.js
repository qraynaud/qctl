/**
 * Env / profile map keys (basename-safe; not reserved layer names).
 */
import { provisionLayerNameSchema } from '@qctl/shared'

/**
 * @param {string | undefined | null} name
 * @returns {string | undefined} Error message, or undefined if ok
 */
export function validateLayerName(name) {
  const r = provisionLayerNameSchema.safeParse(String(name ?? '').trim())
  if (r.success) return undefined
  const issue = r.error.issues[0]
  return issue?.message ?? 'Invalid name'
}
