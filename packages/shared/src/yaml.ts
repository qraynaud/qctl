/**
 * YAML / JSON-ish tree before domain validation (provision, seed templates, …).
 * Prefer this over bare `unknown` for recursive document walks.
 *
 * `Uint8Array` / `Buffer` comes from resolved `!env` (bytes after optional
 * transport decoding).
 */
export type YamlValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | YamlValue[]
  | { [key: string]: YamlValue }

/** Plain YAML/JSON mapping (not an array / scalar). */
export type YamlMapping = { [key: string]: YamlValue }
