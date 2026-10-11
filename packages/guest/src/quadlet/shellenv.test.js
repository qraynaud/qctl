import { evalEnvText, listAssignedKeys } from './shellenv.js'
import { describe, expect, test } from 'bun:test'

describe('evalEnvText', () => {
  test('plain, quotes, comments, export', () => {
    /** @type {Record<string, string | undefined>} */
    const s = {}
    evalEnvText(
      ['# header', 'A=1', "B='x y' # trailing", 'C="q $A"', 'export D=d', 'E=', 'F=a#b', ''].join(
        '\n',
      ),
      s,
    )
    expect(s).toEqual({ A: '1', B: 'x y', C: 'q 1', D: 'd', E: '', F: 'a#b' })
  })

  test('${VAR:-default} honours existing scope and empty', () => {
    /** @type {Record<string, string | undefined>} */
    const s = { SET: 'yes', EMPTY: '' }
    evalEnvText(
      'A=${SET:-no}\nB=${UNSET:-no}\nC=${EMPTY:-d}\nD=${EMPTY-d}\nE=${UNSET:---fake}\nF=${UNSET:-${SET}-x}\n',
      s,
    )
    expect(s.A).toBe('yes')
    expect(s.B).toBe('no')
    expect(s.C).toBe('d')
    expect(s.D).toBe('')
    expect(s.E).toBe('--fake')
    expect(s.F).toBe('yes-x')
  })

  test('later lines see earlier assignments; composition', () => {
    /** @type {Record<string, string | undefined>} */
    const s = {}
    evalEnvText('V=1\nW=${V}-${V}.z\nX=$V$W\n', s)
    expect(s.W).toBe('1-1.z')
    expect(s.X).toBe('11-1.z')
  })

  test('command substitution / junk is rejected', () => {
    expect(() => evalEnvText('A=$(date)\n', {})).toThrow(/command substitution/)
    expect(() => evalEnvText('echo hi\n', {})).toThrow(/unsupported statement/)
  })
})

describe('listAssignedKeys', () => {
  test('only KEY= lines', () => {
    expect(listAssignedKeys('# c\nA=1\n export B=2\nC_D=\n=x\n')).toEqual(['A', 'C_D'])
  })
})
