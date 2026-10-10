const parse = require('./parse.js')
const items = require('./items.js')
const runner = require('./runner.js')
const { VwClient } = require('./client.js')

module.exports = {
  DEFAULT_VW_ACCOUNT: parse.DEFAULT_VW_ACCOUNT,
  expandHomePath: parse.expandHomePath,
  resolveVwAccountId: parse.resolveVwAccountId,
  formatVwAccountId: parse.formatVwAccountId,
  parseVwArgs: parse.parseVwArgs,
  INIT_VW_KEYS: parse.INIT_VW_KEYS,
  parseInitVwArgKeys: parse.parseInitVwArgKeys,
  parseInitVwArgs: parse.parseInitVwArgs,
  STANDARD_FIELDS: parse.STANDARD_FIELDS,
  defaultRunner: runner.defaultRunner,
  accountIdKey: runner.accountIdKey,
  sessionCacheKey: runner.sessionCacheKey,
  accountKey: runner.accountKey,
  valueCacheKey: runner.valueCacheKey,
  isNotLoggedInError: runner.isNotLoggedInError,
  isInvalidSessionError: runner.isInvalidSessionError,
  isBadPasswordText: runner.isBadPasswordText,
  formatUnlockError: runner.formatUnlockError,
  promptMasterPassword: runner.promptMasterPassword,
  extractItemField: items.extractItemField,
  pickAttachment: items.pickAttachment,
  VwClient,
}
