/**
 * Shared Zod brand for VM driver / target ids.
 *
 * Each driver module owns its id: `export const id = vmDriverIdSchema.parse('…')`
 * on the registered {@link VmDriverModule}. Registry membership is separate.
 */
import { z } from 'zod'

/**
 * Non-empty trimmed target id. Brand is compile-time only; `.parse` returns a branded string.
 */
export const vmDriverIdSchema = z.string().trim().min(1).brand('VmDriverId')
