/**
 * Tier-0 / credstore name for an encrypted tank pool.
 * @param {string} poolId
 * @returns {string}
 */
export function tankPassphraseCredName(poolId) {
  const id = String(poolId || '').trim()
  if (!id) throw new Error('tankPassphraseCredName: poolId is required')
  return `tank_passphrase_${id}`
}
