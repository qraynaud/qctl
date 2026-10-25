import {
  SUPERVISOR_METHOD,
  decodeRequestLine,
  decodeResponseLine,
  encodeRequestLine,
  encodeResponseLine,
  isAdminOnlyMethod,
  isAppsMethod,
  supervisorRequestCodec,
  supervisorRequestSchema,
  supervisorResponseCodec,
} from './protocol.js'
import { describe, expect, test } from 'bun:test'

describe('supervisor protocol', () => {
  test('method enum + allowlists', () => {
    expect(SUPERVISOR_METHOD.ENSURE).toBe('ensure')
    expect(isAppsMethod(SUPERVISOR_METHOD.ENSURE)).toBe(true)
    expect(isAppsMethod(SUPERVISOR_METHOD.QUADLET)).toBe(false)
    expect(isAdminOnlyMethod(SUPERVISOR_METHOD.QUADLET)).toBe(true)
  })

  test('request codec round-trip is idempotent', () => {
    const req = {
      method: /** @type {const} */ ('ensure'),
      params: { app: 'web' },
    }
    const line = encodeRequestLine(req)
    expect(line.endsWith('\n')).toBe(true)
    expect(decodeRequestLine(line)).toEqual(req)
    expect(supervisorRequestCodec.decode(supervisorRequestCodec.encode(req))).toEqual(req)
  })

  test('response codec round-trip is idempotent', () => {
    const ok = {
      ok: /** @type {const} */ (true),
      result: {
        stub: /** @type {const} */ (true),
        method: /** @type {const} */ ('ensure'),
        app: 'web',
      },
    }
    const err = { ok: /** @type {const} */ (false), error: 'permission denied' }
    expect(decodeResponseLine(encodeResponseLine(ok))).toEqual(ok)
    expect(decodeResponseLine(encodeResponseLine(err))).toEqual(err)
    expect(supervisorResponseCodec.decode(supervisorResponseCodec.encode(ok))).toEqual(ok)
  })

  test('decodeRequestLine accepts ensure / quadlet', () => {
    expect(decodeRequestLine('{"method":"ensure","params":{"app":"web"}}')).toEqual({
      method: 'ensure',
      params: { app: 'web' },
    })
    expect(decodeRequestLine('{"method":"quadlet","params":{"argv":["ps"]}}\n')).toEqual({
      method: 'quadlet',
      params: { argv: ['ps'] },
    })
  })

  test('codecs reject invalid JSON / unknown method / bad params / bad response', () => {
    expect(() => decodeRequestLine('{')).toThrow()
    expect(() => supervisorRequestSchema.parse({ method: 'nope', params: {} })).toThrow()
    expect(() => decodeRequestLine('{"method":"ensure","params":{}}')).toThrow()
    expect(() => decodeRequestLine('{"method":"ensure","params":{"app":" web"}}')).toThrow()
    expect(() => decodeResponseLine('{"hello":1}')).toThrow()
    expect(() => encodeResponseLine(/** @type {any} */ ({ ok: false, error: '' }))).toThrow()
  })
})
