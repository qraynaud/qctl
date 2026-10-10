#!/usr/bin/env -S bunx zx
/**
 * Custom check: JSDoc / typing hygiene for checkJs.
 *
 * Usage:
 *   bunx zx tooling/check-jsdoc.js
 *   bunx zx tooling/check-jsdoc.js --fix
 *
 * Layout / `@import` (hard failures):
 * - No inline `import('mod').Type` in JSDoc / block comments (`--fix` extracts when safe)
 * - Import paths must not end in `.ts` / `.d.ts` — use `.js` (NodeNext; resolves to `.ts` sources)
 * - One `@import` per module specifier
 * - Named imports lexicographic (by exported name; `as` aliases ignored for sort key)
 * - `@import` blocks ordered by Biome import groups, then specifier localeCompare
 * - Single-line `@import` must fit Biome `lineWidth` (100); otherwise multi-line like Biome imports
 * - Multiline JSDoc (`@import` and other typing tags) must open with `/**` alone — never `/** @…`
 * - Every comment line must fit Biome `lineWidth` (100) — reported only; wrap by hand
 *
 * `--fix` also lifts comment `import('mod').Type` into top-level `@import` (merged per module).
 * Left as errors when the same local type name would resolve from two different modules.
 *
 * Changed-files loose types (warnings only):
 * - `git status` working-copy `.js` / `.ts` (not `.d.ts`) that use `any` / `unknown` / bare `object`
 *   should prefer a qualified type unless the loose type is fully justified
 */
import fs from 'node:fs'
import path from 'node:path'

import { parse as parseComments } from 'comment-parser'

import { ROOT } from './common/root.js'
import { createToolingYargsFromMeta, withFixOption } from './common/yargs-cli.js'

$.verbose = false

const { fix: FIX } = withFixOption(
  createToolingYargsFromMeta(import.meta.url, 'tooling/check-jsdoc.js', {
    strict: true,
  }).usage('$0 [--fix]'),
  'Auto-fix @import layout, .ts paths, and safe inline import() → @import',
).parseSync()

/** Match root biome.json `formatter.lineWidth`. */
const LINE_WIDTH = 100

const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  '.git',
  '.hg',
  '.cursor',
  '.nuxt',
  '.output',
  'coverage',
])

const IMPORT_GROUPS = [
  { id: 'node', test: (s) => s.startsWith('node:') },
  {
    id: 'package',
    test: (s) =>
      !s.startsWith('.')
      && !s.startsWith('/')
      && !s.startsWith('~/')
      && !s.startsWith('#')
      && !s.startsWith('node:')
      && !s.startsWith('@qctl/'),
  },
  { id: 'qctl', test: (s) => s.startsWith('@qctl/') },
  { id: 'hash', test: (s) => s.startsWith('#') },
  {
    id: 'path',
    test: (s) => s.startsWith('.') || s.startsWith('/') || s.startsWith('~/'),
  },
]

/**
 * @param {string} specifier
 * @returns {number}
 */
const groupIndex = (specifier) => {
  const idx = IMPORT_GROUPS.findIndex((g) => g.test(specifier))
  return idx === -1 ? IMPORT_GROUPS.length : idx
}

/**
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (/\.(js|vue)$/.test(entry.name)) {
      yield full
    }
  }
}

/**
 * @param {string} source
 * @returns {{ code: string, isVue: boolean, scriptStart: number }}
 */
const extractScript = (source) => {
  if (!source.includes('<script')) {
    return { code: source, isVue: false, scriptStart: 0 }
  }
  const match = source.match(/<script\b[^>]*>/i)
  if (!match || match.index == null) {
    return { code: source, isVue: false, scriptStart: 0 }
  }
  const openEnd = match.index + match[0].length
  const close = source.indexOf('</script>', openEnd)
  if (close === -1) {
    return { code: source.slice(openEnd), isVue: true, scriptStart: openEnd }
  }
  return { code: source.slice(openEnd, close), isVue: true, scriptStart: openEnd }
}

/**
 * @param {string} source
 * @param {number} index
 */
const isRuntimeImport = (source, index) => {
  const before = source.slice(Math.max(0, index - 80), index)
  return (
    /await\s+$/.test(before)
    || /=>\s*$/.test(before)
    || /=\s*$/.test(before)
    || /\(\s*$/.test(before)
    || /void\s+$/.test(before)
    || /component:\s*$/.test(before)
  )
}

/**
 * NodeNext import paths never use a `.ts` / `.d.ts` suffix — emit / checkJs resolve via `.js`.
 * @param {string} specifier
 */
const isForbiddenTsImportPath = (specifier) => /\.tsx?$/i.test(specifier)

/**
 * @param {string} specifier
 * @returns {string} `.ts` / `.tsx` → `.js` / `.jsx`; leaves `.d.ts` unchanged (manual fix)
 */
const toJsImportPath = (specifier) => {
  if (/\.d\.ts$/i.test(specifier)) {
    return specifier
  }
  return specifier.replace(/\.tsx?$/i, (ext) => (ext.toLowerCase() === '.tsx' ? '.jsx' : '.js'))
}

/**
 * Exported name in an `@import` binding (`Foo` or `Foo as Bar` → `Foo`).
 * @param {string} name
 */
const importNameSortKey = (name) => name.split(/\s+as\s+/)[0]?.trim() ?? name

/**
 * Local name in an `@import` binding (`Foo` or `Foo as Bar` → `Foo` / `Bar`).
 * @param {string} name
 */
const importLocalName = (name) => {
  const parts = name.split(/\s+as\s+/)
  return (parts[1] ?? parts[0])?.trim() ?? name
}

/**
 * @param {string[]} names
 */
const sortNames = (names) =>
  [...names].sort((a, b) => importNameSortKey(a).localeCompare(importNameSortKey(b)))

/**
 * @param {string[]} names
 */
const namesNeedSort = (names) => {
  const sorted = sortNames(names)
  return sorted.some((name, i) => name !== names[i])
}

/**
 * Normalize a module specifier for comparison / @import output.
 * @param {string} specifier
 */
const normalizeImportPath = (specifier) =>
  isForbiddenTsImportPath(specifier) ? toJsImportPath(specifier) : specifier

/**
 * @param {string} module
 * @param {string[]} names
 * @returns {string}
 */
const formatAtImport = (module, names) => {
  const sorted = sortNames(names)
  const single = `/** @import { ${sorted.join(', ')} } from '${module}' */`
  if (single.length <= LINE_WIDTH) {
    return single
  }
  // Multiline: `/**` alone (never `/** @…`), trailing commas like Biome.
  return `/**\n * @import {\n *   ${sorted.join(',\n *   ')},\n * } from '${module}'\n */`
}

/**
 * @param {string} module
 * @param {string[]} names
 */
const atImportExceedsLineWidth = (module, names) =>
  `/** @import { ${sortNames(names).join(', ')} } from '${module}' */`.length > LINE_WIDTH

// Compact single-line: /** @import { ... } from '...' */
const AT_IMPORT_SINGLE_RE = /\/\*\*\s*@import\s*\{[^}\n]*\}\s*from\s*['"][^'"]+['"]\s*\*\//g

// Multiline @import — good (/** alone) or bad (/** @import on one line)
const AT_IMPORT_BLOCK_RE =
  /\/\*\*(?:\s*\n(?:\s*\*[^\n]*\n)*?\s*\*\s*@import|\s+@import)\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*\n?\s*\*\//g

// Multiline JSDoc with a tag on the opening line (/** @type, /** @typedef, …)
const MULTILINE_TAG_ON_OPEN_RE = /\/\*\*\s+@([A-Za-z]+)\b[\s\S]*?\*\//g

/**
 * @typedef {{
 *   module: string,
 *   names: string[],
 *   start: number,
 *   end: number,
 *   line: number,
 * }} AtImportSpan
 */

/**
 * @param {string} code
 * @returns {AtImportSpan[]}
 */
const findAtImportSpans = (code) => {
  /** @type {AtImportSpan[]} */
  const spans = []
  const pushMatch = (match) => {
    const raw = match[0]
    const fromMatch = raw.match(/from\s+(['"])([^'"]+)\1/)
    const namesMatch = raw.match(/@import\s*\{([^}]*)\}/)
    if (!fromMatch || !namesMatch || match.index == null) {
      return
    }
    const names = namesMatch[1]
      .split(',')
      .map((part) => part.replace(/^\s*\*\s?/gm, '').trim())
      .filter(Boolean)
    spans.push({
      module: fromMatch[2],
      names,
      start: match.index,
      end: match.index + raw.length,
      line: code.slice(0, match.index).split('\n').length,
    })
  }
  for (const match of code.matchAll(AT_IMPORT_SINGLE_RE)) {
    pushMatch(match)
  }
  for (const match of code.matchAll(AT_IMPORT_BLOCK_RE)) {
    if (spans.some((s) => s.start === match.index)) {
      continue
    }
    pushMatch(match)
  }
  spans.sort((a, b) => a.start - b.start)
  return spans
}

/**
 * Put `/**` alone when a multiline JSDoc opens with `/** @tag`.
 * Preserves the star-column indent used by the rest of the block.
 * @param {string} code
 */
const fixMultilineTagOnOpen = (code) =>
  code.replace(MULTILINE_TAG_ON_OPEN_RE, (block) => {
    if (!block.includes('\n') || !/^\/\*\*\s+@/.test(block)) {
      return block
    }
    const nextStar = block.match(/\n([ \t]*)\*/)
    const starIndent = nextStar?.[1] ?? ' '
    return block.replace(/^\/\*\*\s+@/, `/**\n${starIndent}* @`)
  })

/**
 * Report source lines that belong to comments and exceed LINE_WIDTH.
 * Skips string / template contents via a small lexer.
 * @param {string} rel
 * @param {string} code
 * @param {string[]} errors
 */
const checkCommentLineWidths = (rel, code, errors) => {
  const lines = code.split('\n')
  /** @type {'code' | 'line' | 'block' | 'sq' | 'dq' | 'tmpl'} */
  let state = 'code'
  /** Lines (1-based) already reported */
  const seen = new Set()

  /**
   * @param {number} lineNo
   * @param {number} length
   */
  const report = (lineNo, length) => {
    if (seen.has(lineNo)) {
      return
    }
    seen.add(lineNo)
    errors.push(`${rel}:${lineNo}: comment exceeds lineWidth ${LINE_WIDTH} (${length} chars)`)
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx]
    const lineNo = lineIdx + 1
    let i = 0
    let lineHasComment = state === 'block' || state === 'line'

    if (state === 'line') {
      // Line comments end at newline (already advanced)
      state = 'code'
    }

    while (i < line.length) {
      const ch = line[i]
      const next = line[i + 1]

      if (state === 'block') {
        lineHasComment = true
        if (ch === '*' && next === '/') {
          state = 'code'
          i += 2
          continue
        }
        i += 1
        continue
      }

      if (state === 'sq' || state === 'dq') {
        if (ch === '\\') {
          i += 2
          continue
        }
        if ((state === 'sq' && ch === "'") || (state === 'dq' && ch === '"')) {
          state = 'code'
        }
        i += 1
        continue
      }

      if (state === 'tmpl') {
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === '`') {
          state = 'code'
          i += 1
          continue
        }
        if (ch === '$' && next === '{') {
          // Enter interpolation as code; naive: treat until matching } at depth 1
          state = 'code'
          i += 2
          continue
        }
        i += 1
        continue
      }

      // code
      if (ch === "'") {
        state = 'sq'
        i += 1
        continue
      }
      if (ch === '"') {
        state = 'dq'
        i += 1
        continue
      }
      if (ch === '`') {
        state = 'tmpl'
        i += 1
        continue
      }
      if (ch === '/' && next === '/') {
        lineHasComment = true
        state = 'line'
        break
      }
      if (ch === '/' && next === '*') {
        lineHasComment = true
        state = 'block'
        i += 2
        continue
      }
      i += 1
    }

    if (lineHasComment && line.length > LINE_WIDTH) {
      report(lineNo, line.length)
    }
  }
}

/**
 * @param {string} rel
 * @param {string} code
 * @param {string[]} errors
 */
const checkMultilineTagOnOpen = (rel, code, errors) => {
  for (const match of code.matchAll(MULTILINE_TAG_ON_OPEN_RE)) {
    const block = match[0]
    if (!block.includes('\n') || match.index == null) {
      continue
    }
    const tag = match[1]
    // `@import` layout is enforced via formatAtImport / span checks.
    if (tag === 'import') {
      continue
    }
    const line = code.slice(0, match.index).split('\n').length
    errors.push(
      `${rel}:${line}: multiline @${tag} must open with /** on its own line (not /** @${tag})`,
    )
  }
}

/**
 * Also use comment-parser for validation (handles odd formatting).
 * @param {string} code
 */
const collectAtImportsViaParser = (code) => {
  /** @type {Array<{ module: string, names: string[], line: number }>} */
  const out = []
  for (const block of parseComments(code, { spacing: 'preserve' })) {
    for (const tag of block.tags.filter((t) => t.tag === 'import')) {
      const rawLine = tag.source.map((s) => s.source).join('\n')
      const fromMatch = rawLine.match(/from\s+(['"])([^'"]+)\1/)
      const namesMatch = rawLine.match(/@import\s*\{([^}]*)\}/)
      if (!fromMatch || !namesMatch) {
        continue
      }
      const names = namesMatch[1]
        .split(',')
        .map((part) => part.replace(/^\s*\*\s?/gm, '').trim())
        .filter(Boolean)
      const line = (block.source[0]?.number ?? tag.source[0]?.number ?? 0) + 1
      out.push({ module: fromMatch[2], names, line })
    }
  }
  return out
}

/**
 * @param {AtImportSpan[]} spans
 */
const mergeByModule = (spans) => {
  /** @type {Map<string, string[]>} */
  const map = new Map()
  for (const span of spans) {
    const prev = map.get(span.module) ?? []
    for (const name of span.names) {
      if (!prev.includes(name)) {
        prev.push(name)
      }
    }
    map.set(span.module, prev)
  }
  return [...map.entries()]
    .map(([module, names]) => ({ module, names: sortNames(names) }))
    .sort((a, b) => {
      const ga = groupIndex(a.module)
      const gb = groupIndex(b.module)
      if (ga !== gb) {
        return ga - gb
      }
      return a.module.localeCompare(b.module)
    })
}

/**
 * @param {string} code
 * @param {AtImportSpan[]} spans
 * @param {Array<{ module: string, names: string[] }>} merged
 */
const rewriteAtImports = (code, spans, merged) => {
  if (!spans.length) {
    return code
  }
  // Replace the contiguous region covering all existing @import comments
  // (plus blank lines between them) with the sorted block.
  const regionStart = spans[0].start
  let regionEnd = spans[spans.length - 1].end
  // Expand to include blank lines between consecutive @imports
  for (let i = 0; i < spans.length - 1; i += 1) {
    const gap = code.slice(spans[i].end, spans[i + 1].start)
    if (!/^[\s\n]*$/.test(gap)) {
      // Non-blank gap: rewrite each cluster separately — for simplicity, still
      // rewrite whole span list only when gaps are whitespace.
      // Fall through: if any non-ws gap, do a full replace of each span reverse.
      let next = code
      const byMod = new Map(merged.map((m) => [m.module, m]))
      for (const span of [...spans].reverse()) {
        const entry = byMod.get(span.module)
        if (!entry) {
          continue
        }
        next = `${next.slice(0, span.start)}${formatAtImport(entry.module, entry.names)}${next.slice(span.end)}`
        byMod.delete(span.module)
      }
      // Prepend any modules not rewritten (shouldn't happen)
      return next
    }
  }
  // Include trailing newline after last block if present
  if (code[regionEnd] === '\n') {
    regionEnd += 1
  }
  // Include one leading newline if the previous char is newline and we're not at start
  const block = `${merged.map((m) => formatAtImport(m.module, m.names)).join('\n')}\n`
  return `${code.slice(0, regionStart)}${block}${code.slice(regionEnd)}`
}

const INLINE_IMPORT_RE = /import\(\s*(['"])([^'"]+)\1\s*\)\.([A-Za-z_][A-Za-z0-9_]*)/g

/**
 * @typedef {{
 *   module: string,
 *   name: string,
 *   start: number,
 *   end: number,
 *   line: number,
 *   raw: string,
 * }} InlineImportHit
 */

/**
 * @param {string} code
 * @param {number} index
 */
const isInComment = (code, index) => {
  const before = code.slice(0, index)
  const lastBlock = before.lastIndexOf('/*')
  const lastBlockEnd = before.lastIndexOf('*/')
  const lastLine = before.lastIndexOf('//')
  const lastNl = before.lastIndexOf('\n')
  return lastBlock > lastBlockEnd || lastLine > lastNl
}

/**
 * @param {string} code
 * @returns {InlineImportHit[]}
 */
const findInlineImportHits = (code) => {
  /** @type {InlineImportHit[]} */
  const hits = []
  for (const match of code.matchAll(INLINE_IMPORT_RE)) {
    const index = match.index ?? 0
    if (isRuntimeImport(code, index) || !isInComment(code, index)) {
      continue
    }
    hits.push({
      module: normalizeImportPath(match[2]),
      name: match[3],
      start: index,
      end: index + match[0].length,
      line: code.slice(0, index).split('\n').length,
      raw: match[0],
    })
  }
  return hits
}

/**
 * Local binding for an export name already present on an `@import` entry, if any.
 * @param {{ module: string, names: string[] }} entry
 * @param {string} exportName
 */
const localBindingForExport = (entry, exportName) => {
  for (const name of entry.names) {
    if (importNameSortKey(name) === exportName) {
      return importLocalName(name)
    }
  }
  return null
}

/**
 * Partition inline hits: extractable vs name conflicts across modules.
 * @param {InlineImportHit[]} hits
 * @param {Array<{ module: string, names: string[] }>} atImports
 * @returns {{
 *   extractable: InlineImportHit[],
 *   conflicts: Array<{ hit: InlineImportHit, modules: string[] }>,
 * }}
 */
const partitionInlineImports = (hits, atImports) => {
  /** @type {Map<string, Set<string>>} */
  const nameModules = new Map()
  /**
   * @param {string} name
   * @param {string} mod
   */
  const add = (name, mod) => {
    const set = nameModules.get(name) ?? new Set()
    set.add(mod)
    nameModules.set(name, set)
  }

  for (const entry of atImports) {
    const mod = normalizeImportPath(entry.module)
    for (const name of entry.names) {
      add(importLocalName(name), mod)
    }
  }
  for (const hit of hits) {
    add(hit.name, hit.module)
  }

  /** @type {InlineImportHit[]} */
  const extractable = []
  /** @type {Array<{ hit: InlineImportHit, modules: string[] }>} */
  const conflicts = []
  for (const hit of hits) {
    const modules = [...(nameModules.get(hit.name) ?? [])].sort()
    if (modules.length > 1) {
      conflicts.push({ hit, modules })
    } else {
      extractable.push(hit)
    }
  }
  return { extractable, conflicts }
}

/**
 * Merge extracted type names into `@import` entries (same formatAtImport line/multiline rules).
 * @param {Array<{ module: string, names: string[] }>} merged
 * @param {InlineImportHit[]} extractable
 */
const mergeExtractedIntoAtImports = (merged, extractable) => {
  /** @type {Map<string, string[]>} */
  const byMod = new Map(merged.map((m) => [m.module, [...m.names]]))
  for (const hit of extractable) {
    const names = byMod.get(hit.module) ?? []
    if (localBindingForExport({ module: hit.module, names }, hit.name) == null) {
      names.push(hit.name)
    }
    byMod.set(hit.module, names)
  }
  return [...byMod.entries()]
    .map(([module, names]) => ({ module, names: sortNames(names) }))
    .sort((a, b) => {
      const ga = groupIndex(a.module)
      const gb = groupIndex(b.module)
      if (ga !== gb) {
        return ga - gb
      }
      return a.module.localeCompare(b.module)
    })
}

/**
 * Offset after leading runtime `import` / `export … from` statements.
 * Inserts before leading comments when there are no runtime imports.
 * @param {string} code
 */
const findAtImportInsertOffset = (code) => {
  let pos = 0
  if (code.startsWith('#!')) {
    const nl = code.indexOf('\n')
    pos = nl === -1 ? code.length : nl + 1
  }
  while (pos < code.length && /[ \t\r\n]/.test(code[pos])) {
    pos += 1
  }
  const contentStart = pos
  let insertAt = contentStart
  let seenImport = false

  /**
   * @param {number} from
   */
  const skipComment = (from) => {
    if (code.startsWith('/*', from)) {
      const end = code.indexOf('*/', from + 2)
      return end === -1 ? code.length : end + 2
    }
    if (code.startsWith('//', from)) {
      const nl = code.indexOf('\n', from)
      return nl === -1 ? code.length : nl + 1
    }
    return from
  }

  /**
   * @param {number} from
   */
  const isImportStmt = (from) => /^import[\s{'"*]/.test(code.slice(from))

  /**
   * @param {number} from
   */
  const endOfStatement = (from) => {
    let i = from
    let quote = /** @type {string | null} */ (null)
    while (i < code.length) {
      const ch = code[i]
      if (quote) {
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === quote) {
          quote = null
        }
        i += 1
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch
        i += 1
        continue
      }
      if (ch === ';') {
        return i + 1
      }
      if (ch === '\n') {
        const line = code.slice(from, i)
        if (
          /from\s+['"][^'"]+['"]\s*$/.test(line)
          || /^import\s+['"][^'"]+['"]\s*$/.test(line.trim())
        ) {
          return i
        }
      }
      i += 1
    }
    return i
  }

  pos = contentStart
  while (pos < code.length) {
    while (pos < code.length && /[ \t\r\n]/.test(code[pos])) {
      pos += 1
    }
    if (code.startsWith('/*', pos) || code.startsWith('//', pos)) {
      if (!seenImport) {
        let after = skipComment(pos)
        while (after < code.length && /[ \t\r\n]/.test(code[after])) {
          after += 1
        }
        if (isImportStmt(after)) {
          pos = skipComment(pos)
          continue
        }
        return contentStart
      }
      break
    }
    if (isImportStmt(pos)) {
      seenImport = true
      pos = endOfStatement(pos)
      insertAt = pos
      continue
    }
    break
  }
  return insertAt
}

/**
 * Replace extractable `import('mod').Name` with the local type name (end → start).
 * @param {string} code
 * @param {InlineImportHit[]} extractable
 * @param {Array<{ module: string, names: string[] }>} merged
 */
const replaceInlineImportsWithNames = (code, extractable, merged) => {
  let next = code
  const ordered = [...extractable].sort((a, b) => b.start - a.start)
  for (const hit of ordered) {
    const entry = merged.find((m) => m.module === hit.module)
    const local = entry != null ? (localBindingForExport(entry, hit.name) ?? hit.name) : hit.name
    next = `${next.slice(0, hit.start)}${local}${next.slice(hit.end)}`
  }
  return next
}

/**
 * Insert or rewrite `@import` blocks for `merged`.
 * @param {string} code
 * @param {AtImportSpan[]} spans
 * @param {Array<{ module: string, names: string[] }>} merged
 */
const applyAtImportMerged = (code, spans, merged) => {
  if (!merged.length) {
    return code
  }
  if (spans.length) {
    const fixedSpans = spans.map((span) => ({
      ...span,
      module: normalizeImportPath(span.module),
    }))
    return rewriteAtImports(code, fixedSpans, merged)
  }
  const offset = findAtImportInsertOffset(code)
  const block = `${merged.map((m) => formatAtImport(m.module, m.names)).join('\n')}\n`
  const prefix = offset > 0 && code[offset - 1] !== '\n' ? '\n' : ''
  // Keep a single separating newline before the following code.
  const rest = code.slice(offset).replace(/^\n*/, '\n')
  return `${code.slice(0, offset)}${prefix}${block}${rest}`
}

/**
 * @param {string} rel
 * @param {string} source
 * @returns {{ errors: string[], fixed: string | null }}
 */
const checkFile = (rel, source) => {
  /** @type {string[]} */
  const errors = []
  const { code, isVue, scriptStart } = extractScript(source)

  const inlineHits = findInlineImportHits(code)
  const spans = findAtImportSpans(code)
  const parsed = collectAtImportsViaParser(code)
  const entries = spans.length
    ? spans.map((s) => ({ ...s, module: normalizeImportPath(s.module) }))
    : parsed.map((p) => ({
        ...p,
        module: normalizeImportPath(p.module),
        start: 0,
        end: 0,
      }))

  const { extractable, conflicts } = partitionInlineImports(inlineHits, entries)

  for (const match of code.matchAll(INLINE_IMPORT_RE)) {
    const index = match.index ?? 0
    if (isRuntimeImport(code, index) || !isInComment(code, index)) {
      continue
    }
    if (isForbiddenTsImportPath(match[2])) {
      const line = code.slice(0, index).split('\n').length
      errors.push(
        `${rel}:${line}: import path must not end in .ts; use '${toJsImportPath(match[2])}' (NodeNext)`,
      )
    }
  }

  for (const { hit, modules } of conflicts) {
    errors.push(
      `${rel}:${hit.line}: cannot extract import('${hit.module}').${hit.name}: '${hit.name}' resolves from multiple modules (${modules.map((m) => `'${m}'`).join(', ')}); leave inline or rename`,
    )
  }
  for (const hit of extractable) {
    errors.push(
      `${rel}:${hit.line}: use top-level /** @import { ${hit.name} } from '${hit.module}' */ instead of inline import()`,
    )
  }

  checkMultilineTagOnOpen(rel, code, errors)
  checkCommentLineWidths(rel, code, errors)

  for (const span of spans) {
    if (isForbiddenTsImportPath(span.module)) {
      const suggested = toJsImportPath(span.module)
      const hint =
        suggested === span.module
          ? 'use a .js specifier (NodeNext)'
          : `use '${suggested}' (NodeNext)`
      errors.push(`${rel}:${span.line}: @import path must not end in .ts; ${hint}`)
    }
  }
  if (!spans.length) {
    for (const entry of parsed) {
      if (isForbiddenTsImportPath(entry.module)) {
        const suggested = toJsImportPath(entry.module)
        const hint =
          suggested === entry.module
            ? 'use a .js specifier (NodeNext)'
            : `use '${suggested}' (NodeNext)`
        errors.push(`${rel}:${entry.line}: @import path must not end in .ts; ${hint}`)
      }
    }
  }

  /** @type {Map<string, number[]>} */
  const byModule = new Map()
  for (const entry of entries) {
    const list = byModule.get(entry.module) ?? []
    list.push(entry.line)
    byModule.set(entry.module, list)
  }
  for (const [mod, lines] of byModule) {
    if (lines.length > 1) {
      errors.push(
        `${rel}:${lines[0]}: duplicate @import for '${mod}' (also line ${lines.slice(1).join(', ')}); merge into one block`,
      )
    }
  }

  for (const entry of entries) {
    if (namesNeedSort(entry.names)) {
      errors.push(
        `${rel}:${entry.line}: @import names must be lexicographic; expected { ${sortNames(entry.names).join(', ')} }`,
      )
    }
  }

  if (entries.length > 1) {
    const expected = mergeByModule(entries)
    const got = entries.map((e) => e.module)
    const want = expected.map((e) => e.module)
    const orderWrong = got.some((mod, i) => mod !== want[i])
    if (orderWrong) {
      errors.push(
        `${rel}:${entries[0].line}: @import modules out of order (Biome organizeImports groups).\n  got:  ${got.join(', ')}\n  want: ${want.join(', ')}`,
      )
    }
  }

  for (const span of spans) {
    const mod = normalizeImportPath(span.module)
    const expected = formatAtImport(mod, span.names)
    const actual = code.slice(span.start, span.end)
    // Compare against normalized module path formatting
    const expectedRaw = formatAtImport(span.module, span.names)
    if (actual === expected || actual === expectedRaw) {
      continue
    }
    if (actual.includes('\n') && /^\/\*\*\s+@import\b/.test(actual)) {
      errors.push(
        `${rel}:${span.line}: multiline @import must open with /** on its own line (not /** @import)`,
      )
    } else if (atImportExceedsLineWidth(mod, span.names) && !actual.includes('\n')) {
      errors.push(
        `${rel}:${span.line}: @import exceeds lineWidth ${LINE_WIDTH}; use multi-line form with /** on its own line`,
      )
    } else if (!isForbiddenTsImportPath(span.module)) {
      errors.push(`${rel}:${span.line}: @import formatting does not match expected layout`)
    }
  }

  const layoutFixable = errors.some(
    (e) =>
      !e.includes('inline import()')
      && !e.includes('cannot extract import(')
      && (e.includes('@import')
        || e.includes('multiline @')
        || e.includes('formatting does not match')
        || e.includes('must not end in .ts')),
  )

  const shouldFix = FIX && (extractable.length > 0 || layoutFixable)

  if (shouldFix) {
    let newCode = code
    const baseMerged = mergeByModule(
      spans.map((span) => ({
        ...span,
        module: normalizeImportPath(span.module),
      })),
    )
    const merged =
      extractable.length > 0 ? mergeExtractedIntoAtImports(baseMerged, extractable) : baseMerged

    // Rewrite / insert @imports first, then re-scan inlines (offsets may shift).
    if (merged.length > 0 && (spans.length > 0 || extractable.length > 0 || layoutFixable)) {
      const spansNow = findAtImportSpans(newCode)
      newCode = applyAtImportMerged(newCode, spansNow, merged)
    }
    if (extractable.length > 0) {
      const ok = new Set(extractable.map((h) => `${h.module}\0${h.name}`))
      const hitsNow = findInlineImportHits(newCode).filter((h) => ok.has(`${h.module}\0${h.name}`))
      newCode = replaceInlineImportsWithNames(newCode, hitsNow, merged)
    }
    newCode = fixMultilineTagOnOpen(newCode)
    if (newCode !== code) {
      if (isVue) {
        return {
          errors,
          fixed: `${source.slice(0, scriptStart)}${newCode}${source.slice(scriptStart + code.length)}`,
        }
      }
      return { errors, fixed: newCode }
    }
  }

  return { errors, fixed: null }
}

const SELF_REL = `tooling${path.sep}check-jsdoc.js`

/**
 * Working-copy `.js` / `.ts` paths from `git status` (modified, added, untracked).
 * Skips `.d.ts` and removed/missing files.
 * @returns {string[]}
 */
const listChangedJsTsFiles = () => {
  const result = $.sync({ cwd: ROOT, nothrow: true })`git status --porcelain --untracked-files=all`
  if (result.exitCode !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim()
    console.error(
      `warning: could not list changed files via git status${detail ? `: ${detail}` : ''}`,
    )
    return []
  }
  return String(result.stdout || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !line.startsWith('D ') && !line.startsWith(' D'))
    .map((line) => {
      // "XY path" or "XY orig -> path" (rename)
      const body = line.slice(3)
      const arrow = body.lastIndexOf(' -> ')
      return (arrow === -1 ? body : body.slice(arrow + 4)).trim()
    })
    .filter((rel) => /\.(js|ts)$/.test(rel) && !rel.endsWith('.d.ts'))
    .filter((rel) => rel !== SELF_REL)
}

/**
 * Match `any` / `unknown` / bare `object` / `Object` as type tokens.
 */
const LOOSE_TYPE_RE = /(?<![A-Za-z0-9_$])(any|unknown|object|Object)(?![A-Za-z0-9_$])/g

/** JSDoc / block comments that may contain type annotations. */
const BLOCK_COMMENT_RE = /\/\*\*?[\s\S]*?\*\//g

/**
 * @param {string} text
 * @param {number} index
 * @returns {boolean}
 */
const isInsideBracesOrGenerics = (text, index) => {
  const before = text.slice(0, index)
  const lastBraceOpen = before.lastIndexOf('{')
  const lastBraceClose = before.lastIndexOf('}')
  if (lastBraceOpen > lastBraceClose) {
    return true
  }
  const lastGenOpen = before.lastIndexOf('<')
  const lastGenClose = before.lastIndexOf('>')
  return lastGenOpen > lastGenClose
}

/**
 * `@typedef {object} Name` followed by `@property` lines is a named shape, not
 * a bare escape hatch — see jsdoc-avoid-any-unknown.
 * @param {string} comment
 * @param {number} index
 * @param {string} token
 */
const isTypedefObjectWithProperties = (comment, index, token) => {
  if (token !== 'object' && token !== 'Object') {
    return false
  }
  const before = comment.slice(Math.max(0, index - 80), index)
  if (!/@typedef\s*\{\s*$/.test(before)) {
    return false
  }
  const after = comment.slice(index + token.length, index + token.length + 400)
  return /\}\s+[A-Za-z_][\w$]*\s*\n(?:\s*\*[^\n]*\n)*?\s*\*\s*@property\b/.test(after)
}

/**
 * Collect loose-type hits from a single comment or TS snippet.
 * @param {string} rel
 * @param {string} text
 * @param {number} baseOffset Absolute offset of `text` within the file
 * @param {string} source Full file (for line numbers)
 * @param {string[]} warnings
 */
const collectLooseTypesFromText = (rel, text, baseOffset, source, warnings) => {
  for (const match of text.matchAll(LOOSE_TYPE_RE)) {
    if (match.index == null) {
      continue
    }
    const token = match[1]
    // Skip quoted runtime typeof checks: typeof x === 'object'
    const prev = text[match.index - 1]
    const next = text[match.index + token.length]
    if ((prev === "'" || prev === '"') && next === prev) {
      continue
    }
    // Skip runtime Object.* and builders like z.object(
    if (token === 'Object' && next === '.') {
      continue
    }
    if (token === 'object' && prev === '.' && next === '(') {
      continue
    }
    if (!isInsideBracesOrGenerics(text, match.index)) {
      const before = text.slice(Math.max(0, match.index - 40), match.index)
      const after = text.slice(match.index, Math.min(text.length, match.index + 40))
      if (
        !(
          /:\s*$/.test(before)
          || /=\s*$/.test(before)
          || /\bas\s+$/.test(before)
          || /[|&]\s*$/.test(before)
          || /^\s*[|&]/.test(after)
        )
      ) {
        continue
      }
    }
    if (isTypedefObjectWithProperties(text, match.index, token)) {
      continue
    }
    const abs = baseOffset + match.index
    const line = source.slice(0, abs).split('\n').length
    warnings.push(
      `${rel}:${line}: prefer a qualified type over \`${token}\` unless fully justified`,
    )
  }
}

/**
 * Strip string contents so TS scans don't flag quotes.
 * @param {string} code
 */
const maskStrings = (code) =>
  code
    .replace(/'(?:\\.|[^'\\])*'/g, (s) => `'${' '.repeat(Math.max(0, s.length - 2))}'`)
    .replace(/"(?:\\.|[^"\\])*"/g, (s) => `"${' '.repeat(Math.max(0, s.length - 2))}"`)
    .replace(/`(?:\\.|[^`\\])*`/g, (s) => `\`${' '.repeat(Math.max(0, s.length - 2))}\``)

/**
 * Scan JSDoc (all files) and TypeScript type positions (`.ts` only).
 * @param {string} rel
 * @param {string} source
 * @returns {string[]}
 */
const findLooseTypeWarnings = (rel, source) => {
  /** @type {string[]} */
  const warnings = []

  for (const match of source.matchAll(BLOCK_COMMENT_RE)) {
    if (match.index == null) {
      continue
    }
    collectLooseTypesFromText(rel, match[0], match.index, source, warnings)
  }

  if (rel.endsWith('.ts')) {
    let code = source
    code = code.replace(BLOCK_COMMENT_RE, (s) => ' '.repeat(s.length))
    code = code.replace(/\/\/[^\n]*/g, (s) => ' '.repeat(s.length))
    code = maskStrings(code)
    collectLooseTypesFromText(rel, code, 0, source, warnings)
  }

  return warnings
}

/**
 * @returns {string[]}
 */
const checkChangedFilesLooseTypes = () => {
  /** @type {string[]} */
  const warnings = []
  for (const rel of listChangedJsTsFiles()) {
    const full = path.join(ROOT, rel)
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      continue
    }
    const source = fs.readFileSync(full, 'utf8')
    warnings.push(...findLooseTypeWarnings(rel, source))
  }
  return warnings
}

/** @type {string[]} */
const allErrors = []
let fixedCount = 0
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file)
  if (rel === SELF_REL) {
    continue
  }
  const source = fs.readFileSync(file, 'utf8')
  const { errors, fixed } = checkFile(rel, source)
  if (fixed != null) {
    fs.writeFileSync(file, fixed)
    fixedCount += 1
  }
  if (!FIX) {
    allErrors.push(...errors)
  }
}

if (FIX) {
  // Re-run check after fix
  /** @type {string[]} */
  const remaining = []
  for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file)
    if (rel === SELF_REL) {
      continue
    }
    const source = fs.readFileSync(file, 'utf8')
    remaining.push(...checkFile(rel, source).errors)
  }
  console.log(`Fixed JSDoc layout in ${fixedCount} file(s)`)
  if (remaining.length) {
    console.error(`JSDoc import/layout check still failing (${remaining.length} issue(s)):\n`)
    for (const error of remaining) {
      console.error(`  ${error}`)
    }
  } else {
    console.log('JSDoc import/layout check passed')
  }
  const fixWarnings = checkChangedFilesLooseTypes()
  if (fixWarnings.length) {
    console.warn(`\nJSDoc loose-type warnings on changed files (${fixWarnings.length}):\n`)
    for (const warning of fixWarnings) {
      console.warn(`  ${warning}`)
    }
    console.warn(
      '\nThese are warnings only — replace with a qualified type unless fully justified.',
    )
  }
  process.exit(remaining.length ? 1 : 0)
}

const looseWarnings = checkChangedFilesLooseTypes()

if (allErrors.length) {
  console.error(`JSDoc import/layout check failed (${allErrors.length} issue(s)):\n`)
  for (const error of allErrors) {
    console.error(`  ${error}`)
  }
  console.error(
    '\nHint: run `bun run test:lint -- --fix` for @import layout, .ts paths, and safe inline import() extraction',
  )
  console.error('      (name conflicts and overlong comments must be fixed by hand)')
} else {
  console.log('JSDoc import/layout check passed')
}

if (looseWarnings.length) {
  console.warn(`\nJSDoc loose-type warnings on changed files (${looseWarnings.length}):\n`)
  for (const warning of looseWarnings) {
    console.warn(`  ${warning}`)
  }
  console.warn('\nThese are warnings only — replace with a qualified type unless fully justified.')
}

process.exit(allErrors.length ? 1 : 0)
