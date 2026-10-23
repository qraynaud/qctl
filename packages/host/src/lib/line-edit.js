/**
 * Line-based ensure / replace / inject for scaffold repair (not AST merge).
 */
import * as fs from 'node:fs'
import { dirname } from 'node:path'

/**
 * @typedef {'added' | 'replaced' | 'injected' | 'unchanged'} LineEditAction
 * @typedef {{ text: string, changed: boolean, action: LineEditAction }} LineEditResult
 * @typedef {'env' | 'json' | 'exact'} KeyStyle
 */

/**
 * @param {string} text
 * @returns {{ lines: string[], endsWithNl: boolean }}
 */
export function parseLines(text) {
  if (text === '') return { lines: [], endsWithNl: true }
  const endsWithNl = text.endsWith('\n')
  const body = endsWithNl ? text.slice(0, -1) : text
  return { lines: body.split('\n'), endsWithNl }
}

/**
 * @param {string[]} lines
 * @param {boolean} [endsWithNl]
 * @returns {string}
 */
export function formatLines(lines, endsWithNl = true) {
  if (lines.length === 0) return endsWithNl ? '' : ''
  return `${lines.join('\n')}${endsWithNl ? '\n' : ''}`
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * @param {string} line
 * @param {string} key
 * @param {KeyStyle} [style]
 * @returns {boolean}
 */
export function lineMatchesKey(line, key, style = 'env') {
  if (style === 'exact') return line === key
  if (style === 'json') {
    return new RegExp(`^\\s*"${escapeRegExp(key)}"\\s*:`).test(line)
  }
  // env: bare KEY (schema stub) or KEY=…
  return line === key || line.startsWith(`${key}=`)
}

/**
 * Append `line` if no exact match exists.
 * @param {string} text
 * @param {string} line
 * @returns {LineEditResult}
 */
export function ensureLine(text, line) {
  const { lines, endsWithNl } = parseLines(text)
  if (lines.includes(line)) {
    return { text: formatLines(lines, endsWithNl), changed: false, action: 'unchanged' }
  }
  return {
    text: formatLines([...lines, line], true),
    changed: true,
    action: 'added',
  }
}

/**
 * Replace the first line matching `key` (see {@link lineMatchesKey}).
 * @param {string} text
 * @param {string} key
 * @param {string} newLine Full replacement line
 * @param {{ style?: KeyStyle, createIfMissing?: boolean }} [opts]
 * @returns {LineEditResult}
 */
export function replaceByKey(text, key, newLine, opts = {}) {
  const style = opts.style ?? 'env'
  const { lines, endsWithNl } = parseLines(text)
  const idx = lines.findIndex((l) => lineMatchesKey(l, key, style))
  if (idx === -1) {
    if (opts.createIfMissing) return ensureLine(text, newLine)
    return { text: formatLines(lines, endsWithNl), changed: false, action: 'unchanged' }
  }
  if (lines[idx] === newLine) {
    return { text: formatLines(lines, endsWithNl), changed: false, action: 'unchanged' }
  }
  const next = lines.slice()
  next[idx] = newLine
  return { text: formatLines(next, endsWithNl), changed: true, action: 'replaced' }
}

/**
 * Insert `insert` lines immediately after the first matching anchor line.
 * @param {string} text
 * @param {string | ((line: string) => boolean)} anchor Exact line, or predicate
 * @param {string | string[]} insert
 * @param {{ appendIfMissing?: boolean }} [opts]
 * @returns {LineEditResult & { missingAnchor?: boolean }}
 */
export function injectAfter(text, anchor, insert, opts = {}) {
  const { lines, endsWithNl } = parseLines(text)
  const chunk = Array.isArray(insert) ? insert : [insert]
  /** @type {(line: string) => boolean} */
  const pred = typeof anchor === 'function' ? anchor : (line) => line === anchor
  const idx = lines.findIndex(pred)
  if (idx === -1) {
    if (opts.appendIfMissing) {
      return {
        text: formatLines([...lines, ...chunk], true),
        changed: true,
        action: 'injected',
        missingAnchor: true,
      }
    }
    return {
      text: formatLines(lines, endsWithNl),
      changed: false,
      action: 'unchanged',
      missingAnchor: true,
    }
  }
  const next = [...lines.slice(0, idx + 1), ...chunk, ...lines.slice(idx + 1)]
  return { text: formatLines(next, endsWithNl), changed: true, action: 'injected' }
}

/**
 * @typedef {LineEditResult & { path: string, dryRun?: boolean }} FileLineEditResult
 */

/**
 * @param {string} path
 * @param {(text: string) => LineEditResult} edit
 * @param {{ dryRun?: boolean, create?: boolean }} [opts]
 * @returns {FileLineEditResult}
 */
export function editFileLines(path, edit, opts = {}) {
  const exists = fs.existsSync(path)
  if (!exists && !opts.create) {
    return { path, text: '', changed: false, action: 'unchanged', dryRun: opts.dryRun }
  }
  const before = exists ? fs.readFileSync(path, 'utf8') : ''
  const result = edit(before)
  if (result.changed && !opts.dryRun) {
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, result.text, 'utf8')
  }
  return { path, ...result, dryRun: opts.dryRun }
}

/**
 * @param {string} path
 * @param {string} line
 * @param {{ dryRun?: boolean, create?: boolean }} [opts]
 * @returns {FileLineEditResult}
 */
export function ensureLineInFile(path, line, opts = {}) {
  return editFileLines(path, (text) => ensureLine(text, line), { create: true, ...opts })
}

/**
 * @param {string} path
 * @param {string} key
 * @param {string} newLine
 * @param {{ dryRun?: boolean, create?: boolean, style?: KeyStyle, createIfMissing?: boolean }} [opts]
 * @returns {FileLineEditResult}
 */
export function replaceByKeyInFile(path, key, newLine, opts = {}) {
  const { style, createIfMissing, ...fileOpts } = opts
  return editFileLines(
    path,
    (text) => replaceByKey(text, key, newLine, { style, createIfMissing }),
    { create: true, ...fileOpts },
  )
}

/**
 * @param {string} path
 * @param {string | ((line: string) => boolean)} anchor
 * @param {string | string[]} insert
 * @param {{ dryRun?: boolean, create?: boolean, appendIfMissing?: boolean }} [opts]
 * @returns {FileLineEditResult}
 */
export function injectAfterInFile(path, anchor, insert, opts = {}) {
  const { appendIfMissing, ...fileOpts } = opts
  return editFileLines(path, (text) => injectAfter(text, anchor, insert, { appendIfMissing }), {
    create: true,
    ...fileOpts,
  })
}
