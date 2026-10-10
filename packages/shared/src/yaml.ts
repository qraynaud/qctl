/**
 * YAML / JSON-ish tree before domain validation (provision, seed templates, …).
 * Prefer this over bare `unknown` for recursive document walks.
 */
export type YamlValue =
  | null
  | boolean
  | number
  | string
  | YamlValue[]
  | { [key: string]: YamlValue }

/** Plain YAML/JSON mapping (not an array / scalar). */
export type YamlMapping = { [key: string]: YamlValue }
