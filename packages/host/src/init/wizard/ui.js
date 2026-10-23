/**
 * Clack has no formal “sections”; `log.step` is the usual phase marker.
 * Scoped questions use `[env|profile|target:name]` prefixes — see {@link wizardScoped}.
 */

/**
 * @typedef {{
 *   log?: { step?: (message: string) => void }
 * }} WizardUi
 */

/**
 * Which layer a prompt is about (shown as `[kind:name]`).
 * @typedef {'env' | 'profile' | 'target'} WizardScopeKind
 */

/**
 * Subject of the current question — tag only what you are configuring
 * (env prompts → `env`, profile prompts → `profile`, …), not related layers.
 * @typedef {object} WizardScope
 * @property {string} [env]
 * @property {string} [profile]
 * @property {string} [target]
 */

/**
 * Bracket tags for a scope, e.g. `[profile:lab]`.
 * Order when several are set: env → profile → target (rare; prefer one).
 * @param {WizardScope | null | undefined} scope
 * @returns {string} Space-joined tags, or `''` when nothing set
 */
export function wizardScopePrefix(scope) {
  if (!scope) return ''
  /** @type {string[]} */
  const tags = []
  if (scope.env) tags.push(`[env:${scope.env}]`)
  if (scope.profile) tags.push(`[profile:${scope.profile}]`)
  if (scope.target) tags.push(`[target:${scope.target}]`)
  return tags.join(' ')
}

/**
 * Prefix a prompt or step message with scope tags when present.
 * @param {WizardScope | null | undefined} scope
 * @param {string} message
 * @returns {string}
 */
export function wizardScoped(scope, message) {
  const prefix = wizardScopePrefix(scope)
  return prefix ? `${prefix} ${message}` : message
}

/**
 * Print a section header in the wizard stream (no-op if prompts lack `log.step`).
 * @param {WizardUi | null | undefined} prompts
 * @param {string} title
 */
export function wizardStep(prompts, title) {
  prompts?.log?.step?.(title)
}
