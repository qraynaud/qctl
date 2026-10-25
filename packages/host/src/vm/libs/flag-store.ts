/**
 * Generic per-VM flag store for hypervisor targets.
 *
 * Storage is target-private (Proxmox tags, libvirt metadata, …). Callers pass a
 * {@link VmFlagDef} (name + Zod schema). Wire framing is JSON via `jsonCodec`
 * in `flags.js`. Implementations must scope keys (e.g. `qctl.<name>`).
 *
 * Domain values are {@link z.output} on both {@link VmFlagStore.get} and
 * {@link VmFlagStore.set}. {@link VmFlagStore.get} parses wire through the
 * schema (so coerce schemas still work on read). Absence is not `undefined` on
 * get — use {@link VmFlagStore.has}.
 */
import type { z } from 'zod'

/** Named flag. Create via `defineFlag` in `flags.js`. */
export type VmFlagDef<S extends z.ZodType = z.ZodType> = {
  readonly name: string
  readonly schema: S
}

/** Bound store for one VM (identity closed over by `createFlagStore`). */
export type VmFlagStore = {
  /** True when a wire value is present for this flag (decode not required). */
  has: <S extends z.ZodType>(flag: VmFlagDef<S>) => Promise<boolean>
  /**
   * Domain value after parsing wire through the schema.
   * Throws if absent (see {@link VmFlagStore.has}).
   */
  get: <S extends z.ZodType>(flag: VmFlagDef<S>) => Promise<z.output<S>>
  /** Store a canonical domain value (`z.output`). */
  set: <S extends z.ZodType>(flag: VmFlagDef<S>, value: z.output<S>) => Promise<void>
  /** Remove the flag (`has` → false; `get` throws). */
  delete: <S extends z.ZodType>(flag: VmFlagDef<S>) => Promise<void>
  /**
   * `{ name, schema, value }` for a present flag. Throws if absent.
   */
  entry: <S extends z.ZodType>(
    flag: VmFlagDef<S>,
  ) => Promise<{ name: string; schema: S; value: z.output<S> }>
}
