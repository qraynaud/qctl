/** @import { EnvGraph } from './builtins.js' */

/** @typedef {EnvGraph['configSchema'][string]} ConfigItem */

/**
 * Sensitivity as qctl means it — same as varlock: unmarked items are sensitive;
 * `@public` opts out. Prefer `@public` / `@optional` over file-wide defaults.
 * @param {ConfigItem} item
 * @returns {boolean}
 */
export function isSensitiveItem(item) {
  return item.isSensitive === true
}

/**
 * Static check: an explicit `@sensitive` (not `=false`) decorator on any definition of `item`.
 * @param {ConfigItem} item
 * @returns {boolean}
 */
export function declaresSensitive(item) {
  for (const def of item.defs) {
    for (const dec of def.itemDef.parsedDecorators ?? []) {
      if (dec.name !== 'sensitive') continue
      const lit = /** @type {{ value?: unknown } | undefined} */ (dec.value)
      if (lit?.value !== false) return true
    }
  }
  return false
}
