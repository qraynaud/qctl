/**
 * Minimal POSIX-ish evaluator for `KEY=value` env files, matching what the old
 * bash tooling got from `set -a; source file`: quotes, `${VAR}`, `${VAR:-default}`,
 * `$VAR`, trailing `# comments`, optional `export`. No command substitution.
 */
import { die } from '../errors.js'

/** @typedef {Record<string, string | undefined>} Scope */

const NAME_RE = /[A-Za-z_][A-Za-z0-9_]*/y

/**
 * Keys on `^NAME=` lines (what the old grep collected for substitution).
 * @param {string} text
 * @returns {string[]}
 */
export function listAssignedKeys(text) {
  /** @type {string[]} */
  const keys = []
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)
    if (m?.[1]) keys.push(m[1])
  }
  return keys
}

/**
 * Expand `$…` constructs in a double-quote-like context.
 * @param {string} s
 * @param {Scope} scope
 * @returns {string}
 */
export function expandDollar(s, scope) {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c !== '$') {
      out += c
      i++
      continue
    }
    const r = readDollar(s, i, scope)
    out += r.value
    i = r.next
  }
  return out
}

/**
 * @param {string} s
 * @param {number} i index of `$`
 * @param {Scope} scope
 * @returns {{ value: string, next: number }}
 */
function readDollar(s, i, scope) {
  const n = s[i + 1]
  if (n === '(') die(`command substitution not supported in env file: ${s.slice(i, i + 20)}`)
  if (n === '{') {
    let depth = 1
    let j = i + 2
    while (j < s.length && depth > 0) {
      if (s[j] === '$' && s[j + 1] === '{') {
        depth++
        j += 2
        continue
      }
      if (s[j] === '}') depth--
      j++
    }
    if (depth !== 0) die(`unterminated \${ in env value: ${s.slice(i, i + 30)}`)
    const body = s.slice(i + 2, j - 1)
    return { value: expandBrace(body, scope), next: j }
  }
  NAME_RE.lastIndex = i + 1
  const m = NAME_RE.exec(s)
  if (m) return { value: scope[m[0]] ?? '', next: i + 1 + m[0].length }
  return { value: '$', next: i + 1 }
}

/**
 * @param {string} body contents between `${` and `}`
 * @param {Scope} scope
 * @returns {string}
 */
function expandBrace(body, scope) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-=+?])([\s\S]*))?$/.exec(body)
  if (!m) die(`unsupported parameter expansion: \${${body}}`)
  const name = /** @type {string} */ (m[1])
  const op = m[2]
  const word = m[3] ?? ''
  const val = scope[name]
  if (!op) return val ?? ''
  const colon = op.startsWith(':')
  const unsetOrNull = val === undefined || (colon && val === '')
  switch (op.slice(-1)) {
    case '-':
      return unsetOrNull ? expandDollar(word, scope) : /** @type {string} */ (val)
    case '=': {
      if (!unsetOrNull) return /** @type {string} */ (val)
      const d = expandDollar(word, scope)
      scope[name] = d
      return d
    }
    case '+':
      return unsetOrNull ? '' : expandDollar(word, scope)
    case '?':
      if (unsetOrNull) die(`${name}: ${expandDollar(word, scope) || 'parameter null or not set'}`)
      return /** @type {string} */ (val)
    default:
      return val ?? ''
  }
}

/**
 * Evaluate env-file text, mutating `scope` (like `set -a; source`).
 * @param {string} text
 * @param {Scope} scope
 * @param {string} [label] for error messages
 */
export function evalEnvText(text, scope, label = 'env file') {
  let i = 0
  const n = text.length
  const fail = (/** @type {string} */ msg) => die(`${label}: ${msg}`)

  while (i < n) {
    // skip blank space + newlines
    while (i < n && /\s/.test(/** @type {string} */ (text[i]))) i++
    if (i >= n) break
    if (text[i] === '#') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (text.startsWith('export', i) && /\s/.test(text[i + 6] ?? '')) {
      i += 6
      while (text[i] === ' ' || text[i] === '\t') i++
    }
    NAME_RE.lastIndex = i
    const nm = NAME_RE.exec(text)
    if (!nm || text[i + nm[0].length] !== '=') {
      fail(`unsupported statement near: ${text.slice(i, i + 30).split('\n')[0]}`)
    }
    const name = /** @type {RegExpExecArray} */ (nm)[0]
    i += name.length + 1

    let value = ''
    for (;;) {
      const c = text[i]
      if (c === undefined || c === '\n' || c === ' ' || c === '\t') break
      if (c === "'") {
        const end = text.indexOf("'", i + 1)
        if (end < 0) fail('unterminated single quote')
        value += text.slice(i + 1, end)
        i = end + 1
      } else if (c === '"') {
        i++
        let chunk = ''
        for (;;) {
          const d = text[i]
          if (d === undefined) fail('unterminated double quote')
          if (d === '"') {
            i++
            break
          }
          if (d === '\\' && /["\\$`\n]/.test(text[i + 1] ?? '')) {
            if (text[i + 1] === '$')
              chunk += '\u0000' // escaped $ placeholder
            else if (text[i + 1] !== '\n') chunk += text[i + 1]
            i += 2
            continue
          }
          chunk += d
          i++
        }
        value += expandDollar(chunk, scope).replaceAll('\u0000', '$')
      } else if (c === '\\') {
        if (text[i + 1] === '\n') {
          i += 2
        } else {
          value += text[i + 1] ?? ''
          i += 2
        }
      } else if (c === '$') {
        const r = readDollar(text, i, scope)
        value += r.value
        i = r.next
      } else {
        value += c
        i++
      }
    }
    scope[name] = value

    // rest of line: whitespace then optional comment
    while (text[i] === ' ' || text[i] === '\t') i++
    if (text[i] === '#') while (i < n && text[i] !== '\n') i++
    else if (i < n && text[i] !== '\n')
      fail(`multiple assignments on one line unsupported near: ${text.slice(i, i + 20)}`)
  }
}
