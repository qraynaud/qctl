import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ensureLine,
  ensureLineInFile,
  injectAfter,
  injectAfterInFile,
  lineMatchesKey,
  replaceByKey,
  replaceByKeyInFile,
} from './line-edit.js'
import { describe, expect, test } from 'bun:test'

describe('lineMatchesKey', () => {
  test('env style', () => {
    expect(lineMatchesKey('FOO=', 'FOO')).toBe(true)
    expect(lineMatchesKey('FOO=bar', 'FOO')).toBe(true)
    expect(lineMatchesKey('FOO', 'FOO')).toBe(true)
    expect(lineMatchesKey('FOOBAR=1', 'FOO')).toBe(false)
    expect(lineMatchesKey('# FOO=1', 'FOO')).toBe(false)
  })

  test('json style', () => {
    expect(lineMatchesKey('  "name": "x",', 'name', 'json')).toBe(true)
    expect(lineMatchesKey('"private": true,', 'private', 'json')).toBe(true)
    expect(lineMatchesKey('  "namex": 1,', 'name', 'json')).toBe(false)
  })
})

describe('ensureLine', () => {
  test('appends when missing and is idempotent', () => {
    const a = ensureLine('a\n', 'b')
    expect(a).toEqual({ text: 'a\nb\n', changed: true, action: 'added' })
    const b = ensureLine(a.text, 'b')
    expect(b.changed).toBe(false)
    expect(b.action).toBe('unchanged')
    expect(b.text).toBe('a\nb\n')
  })

  test('works on empty text', () => {
    expect(ensureLine('', 'x')).toEqual({ text: 'x\n', changed: true, action: 'added' })
  })
})

describe('replaceByKey', () => {
  test('replaces env assignment', () => {
    const r = replaceByKey('A=1\nB=2\n', 'B', 'B=9')
    expect(r).toEqual({ text: 'A=1\nB=9\n', changed: true, action: 'replaced' })
  })

  test('unchanged when missing unless createIfMissing', () => {
    const miss = replaceByKey('A=1\n', 'B', 'B=2')
    expect(miss.changed).toBe(false)
    const add = replaceByKey('A=1\n', 'B', 'B=2', { createIfMissing: true })
    expect(add).toEqual({ text: 'A=1\nB=2\n', changed: true, action: 'added' })
  })

  test('json name line', () => {
    const src = '{\n  "name": "old",\n  "private": true\n}\n'
    const r = replaceByKey(src, 'name', '  "name": "new",', { style: 'json' })
    expect(r.changed).toBe(true)
    expect(r.text).toContain('"name": "new"')
    expect(r.text).toContain('"private": true')
  })
})

describe('injectAfter', () => {
  test('inserts after exact anchor', () => {
    const r = injectAfter('a\nb\nc\n', 'b', 'x')
    expect(r).toEqual({ text: 'a\nb\nx\nc\n', changed: true, action: 'injected' })
  })

  test('predicate anchor + multi-line insert', () => {
    const r = injectAfter('keep\n# ---\ntail\n', (l) => l.startsWith('# ---'), ['x=1', 'y=2'])
    expect(r.text).toBe('keep\n# ---\nx=1\ny=2\ntail\n')
  })

  test('missing anchor unchanged unless appendIfMissing', () => {
    const miss = injectAfter('a\n', 'nope', 'x')
    expect(miss.changed).toBe(false)
    expect(miss.missingAnchor).toBe(true)
    const app = injectAfter('a\n', 'nope', 'x', { appendIfMissing: true })
    expect(app.text).toBe('a\nx\n')
    expect(app.missingAnchor).toBe(true)
  })
})

describe('file helpers', () => {
  test('ensureLineInFile / replaceByKeyInFile / injectAfterInFile + dryRun', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qctl-line-'))
    const path = join(dir, 'f.env')
    writeFileSync(path, 'A=1\n', 'utf8')

    const dry = ensureLineInFile(path, 'B=2', { dryRun: true })
    expect(dry.changed).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('A=1\n')

    ensureLineInFile(path, 'B=2')
    expect(readFileSync(path, 'utf8')).toBe('A=1\nB=2\n')

    replaceByKeyInFile(path, 'A', 'A=9')
    expect(readFileSync(path, 'utf8')).toBe('A=9\nB=2\n')

    injectAfterInFile(path, 'A=9', 'C=3')
    expect(readFileSync(path, 'utf8')).toBe('A=9\nC=3\nB=2\n')
  })
})
