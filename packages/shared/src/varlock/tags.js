/**
 * Schema `@tag(guest)` — host→guest secret: seed into credstore, load via
 * `LoadCredentialEncrypted=<KEY>`, hydrate from `$CREDENTIALS_DIRECTORY/<KEY>` when unset.
 */
export const GUEST_TAG = 'guest'

/**
 * Bootstrap binding `@tag(container-registry)` — value `registry|username|token`
 * for the registry-login stage (declare in `bootstrap/.env.<env>`, not the schema contract).
 */
export const CONTAINER_REGISTRY_TAG = 'container-registry'
