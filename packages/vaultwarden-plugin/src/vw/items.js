/**
 * @typedef {object} BwField
 * @property {string} name
 * @property {string | null} [value]
 */

/**
 * @typedef {object} BwAttachment
 * @property {string} id
 * @property {string} fileName
 */

/**
 * Subset of the `bw get item` JSON we use.
 * @typedef {object} BwItem
 * @property {string} id
 * @property {string} name
 * @property {string | null} [notes]
 * @property {{
 *   username?: string | null,
 *   password?: string | null,
 *   totp?: string | null,
 *   uris?: { uri?: string | null }[],
 * } | null} [login]
 * @property {BwField[] | null} [fields]
 * @property {BwAttachment[] | null} [attachments]
 */

/**
 * Pull a field out of a `bw get item` object.
 * Standard: password, username, notes, totp, uri. Anything else = custom field (case-insensitive).
 * @param {BwItem} item
 * @param {string} field
 * @returns {string}
 */
function extractItemField(item, field) {
  const key = field.toLowerCase()
  /** @type {string | null | undefined} */
  let val
  switch (key) {
    case 'password':
      val = item.login?.password
      break
    case 'username':
      val = item.login?.username
      break
    case 'notes':
      val = item.notes
      break
    case 'totp':
      val = item.login?.totp
      break
    case 'uri':
      val = item.login?.uris?.[0]?.uri
      break
    default: {
      const custom = (item.fields ?? []).find((f) => (f.name ?? '').toLowerCase() === key)
      if (!custom) {
        const have = (item.fields ?? []).map((f) => f.name).join(', ') || 'none'
        throw new Error(
          `field "${field}" not found on item "${item.name}" (custom fields: ${have})`,
        )
      }
      val = custom.value ?? ''
    }
  }
  if (val == null) throw new Error(`item "${item.name}" has no ${key}`)
  return val
}

/**
 * @param {BwItem} item
 * @param {string} fileName
 * @returns {BwAttachment}
 */
function pickAttachment(item, fileName) {
  const att = (item.attachments ?? []).find((a) => a.fileName === fileName)
  if (!att) {
    const have = (item.attachments ?? []).map((a) => a.fileName).join(', ') || 'none'
    throw new Error(
      `attachment "${fileName}" not found on item "${item.name}" (attachments: ${have})`,
    )
  }
  return att
}

module.exports = {
  extractItemField,
  pickAttachment,
}
